# OrbitDMX

![OrbitDMX Icon](icon.png)

A modern, open-source stage lighting DMX controller built with web technologies, designed to provide high-performance, low-latency DMX light triggering across platforms.

## Features

- **Modern User Interface:** Built with React and styled for an intuitive lighting control experience.
- **Cross-Platform:** Powered by Electron, running on Windows, macOS, and Linux.
- **Low Latency:** Uses direct serial communication via `serialport` for precise DMX hardware control.
- **Hardware Integration:** Compatible with FTDI-based USB-to-DMX adapters.
- **Headless Potential:** Architecture supports transition to headless Raspberry Pi setups with web-based remote control.

## Tech Stack

- **Framework:** [Electron](https://www.electronjs.org/) & [React](https://reactjs.org/)
- **Build Tool:** [Vite](https://vitejs.dev/) with Electron Forge
- **State Management:** [Zustand](https://github.com/pmndrs/zustand)
- **Hardware Communication:** [SerialPort](https://serialport.io/) & [USB](https://github.com/tessel/node-usb)

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- An FTDI-based USB-to-DMX interface

## Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Akashic-Trance-Machines/OrbitDMX.git
   cd OrbitDMX
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm start
   ```

## Packaging

To package the application for your operating system:

```bash
npm run package
```

To create distributables (installers, zip files, etc.):

```bash
npm run make
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
