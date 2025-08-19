#!/usr/bin/env python3
import os
import json
import time
import threading
from collections import deque
from datetime import datetime

from flask import Flask, render_template, Response, jsonify

try:
    import serial  # from pyserial
    from serial import SerialException
except Exception as e:
    serial = None
    SerialException = Exception

# Configuration
COM_PORT = os.environ.get("COM_PORT", "COM4")
BAUDRATE = int(os.environ.get("BAUDRATE", "4800"))
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "1.0"))
HISTORY_MAX = int(os.environ.get("HISTORY_MAX", "7200"))
FALLBACK_TO_SIM = os.environ.get("SIMULATE_ON_ERROR", "1") == "1"

# Modbus query frame for ID 1: function 0x03, start 0x0000, count 0x07, CRC 0x04 0x08
QUERY_FRAME = bytes([0x01, 0x03, 0x00, 0x00, 0x00, 0x07, 0x04, 0x08])

# State
app = Flask(__name__)
history = deque(maxlen=HISTORY_MAX)
_last_seq = 0
_cond = threading.Condition()
_is_simulating = False
_worker_started = False

def _crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc & 0xFFFF

def _parse_frame(frame: bytes):
    if len(frame) != 19:
        raise ValueError(f"Invalid frame length: {len(frame)}")
    # CRC check
    data_wo_crc = frame[:-2]
    crc_expected = frame[-2] | (frame[-1] << 8)
    crc_calc = _crc16_modbus(data_wo_crc)
    if crc_expected != crc_calc:
        raise ValueError(f"CRC mismatch: expected 0x{crc_expected:04X}, got 0x{crc_calc:04X}")
    if frame[1] != 0x03:
        raise ValueError(f"Unexpected function code: {frame[1]}")
    if frame[2] != 14:
        raise ValueError(f"Unexpected byte count: {frame[2]}")
    # parse registers (big-endian)
    regs = []
    for i in range(7):
        hi = frame[3 + 2 * i]
        lo = frame[4 + 2 * i]
        regs.append((hi << 8) | lo)
    return {
        "sensor_id": frame[0],
        "humidity": regs[0] / 10.0,
        "temperature": regs[1] / 10.0,
        "conductivity": regs[2],
        "ph": regs[3] / 10.0,
        "nitrogen": regs[4],
        "phosphorus": regs[5],
        "potassium": regs[6],
    }

def _serial_worker():
    global _last_seq, _is_simulating
    ser = None
    if serial is not None:
        try:
            ser = serial.Serial(COM_PORT, BAUDRATE, timeout=0.5)
            _is_simulating = False
        except Exception:
            if not FALLBACK_TO_SIM:
                raise
            ser = None
            _is_simulating = True
    else:
        _is_simulating = True

    sim_state = {
        "humidity": 55.0,
        "temperature": 28.5,
        "conductivity": 450,
        "ph": 6.5,
        "nitrogen": 20,
        "phosphorus": 15,
        "potassium": 30,
    }

    import random

    while True:
        try:
            if ser is not None:
                try:
                    ser.reset_input_buffer()
                except Exception:
                    pass
                ser.write(QUERY_FRAME)
                time.sleep(0.2)
                resp = ser.read(19)
                if len(resp) != 19:
                    time.sleep(max(0.1, POLL_INTERVAL - 0.2))
                    continue
                data = _parse_frame(resp)
            else:
                # generate simulated data with noise and clamp ranges
                sim_state["humidity"] += (0.1 - 0.2 * random.random())
                sim_state["temperature"] += (0.05 - 0.1 * random.random())
                sim_state["ph"] += (0.02 - 0.04 * random.random())
                sim_state["conductivity"] += int(2 - 4 * random.random())
                sim_state["nitrogen"] += int(0.4 - 0.8 * random.random())
                sim_state["phosphorus"] += int(0.4 - 0.8 * random.random())
                sim_state["potassium"] += int(0.4 - 0.8 * random.random())

                sim_state["humidity"] = max(0, min(100, sim_state["humidity"]))
                sim_state["temperature"] = max(-20, min(60, sim_state["temperature"]))
                sim_state["ph"] = max(0, min(14, sim_state["ph"]))
                sim_state["conductivity"] = max(0, sim_state["conductivity"])
                sim_state["nitrogen"] = max(0, sim_state["nitrogen"])
                sim_state["phosphorus"] = max(0, sim_state["phosphorus"])
                sim_state["potassium"] = max(0, sim_state["potassium"])

                data = {"sensor_id": 1, **sim_state}

            data["timestamp"] = datetime.utcnow().isoformat() + "Z"
            with _cond:
                history.append(data)
                _last_seq += 1
                _cond.notify_all()
            time.sleep(max(0.1, POLL_INTERVAL - 0.2))
        except Exception:
            if ser is not None and FALLBACK_TO_SIM:
                try:
                    ser.close()
                except Exception:
                    pass
                ser = None
                _is_simulating = True
            time.sleep(1.0)

def start_worker_once():
    global _worker_started
    if not _worker_started:
        t = threading.Thread(target=_serial_worker, daemon=True)
        t.start()
        _worker_started = True

@app.route("/")
def index():
    start_worker_once()
    return render_template("index.html")

@app.route("/status")
def status():
    return jsonify({
        "simulating": _is_simulating,
        "com_port": COM_PORT,
        "baudrate": BAUDRATE,
        "history_len": len(history),
    })

@app.route("/history")
def get_history():
    start_worker_once()
    return jsonify(list(history)[-500:])

@app.route("/stream")
def stream():
    start_worker_once()
    def event_stream(last_seen):
        while True:
            with _cond:
                _cond.wait_for(lambda: _last_seq != last_seen)
                last_seen = _last_seq
                payload = json.dumps(history[-1])
            yield f"data: {payload}\n\n"
    return Response(event_stream(_last_seq), mimetype="text/event-stream")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)
