// Singleton para compartir la instancia de Socket.IO entre server.js y las rutas
let _io = null

export function setIo(io) {
  _io = io
}

export function getIo() {
  return _io
}
