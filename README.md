# Phytoguard Dashboard

A real-time soil NPK monitoring dashboard built with Flask, Server-Sent Events (SSE), Tailwind CSS and Chart.js. Displays humidity, temperature, pH, conductivity and N-P-K nutrient levels from a Modbus soil sensor.

## Features

- Real-time streaming of sensor data via SSE
- Live cards for humidity, temperature, pH, EC and N-P-K values
- Toggle between single metric chart and multi metric charts
- Responsive design with Tailwind CSS and custom green glassmorphism theme
- Simulation mode if the serial port is unavailable
- Configurable COM port, baudrate and poll interval via environment variables

## Quick Start

1. Install Python 3.10+.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Connect your soil NPK sensor on a serial port (default `COM4` at 4800 baud).
   - On Unix, set `COM_PORT` to something like `/dev/ttyUSB0`.
4. Run the app:
   ```bash
   python app.py
   ```
5. Open a browser at `http://localhost:5000/`.

Set environment variables to change COM port, baudrate or polling interval:
```bash
set COM_PORT=COM3
set BAUDRATE=9600
set POLL_INTERVAL=0.5
```

## Repository structure

- `app.py` — Flask application with SSE streaming and sensor polling.
- `templates/index.html` — Jinja2 template for the dashboard page.
- `static/app.js` — Frontend logic with Chart.js and SSE client.
- `static/logo.png` — Logo image (replace with your own logo).
- `requirements.txt` — Python dependencies.

## License

MIT License. See `LICENSE` file for details.
