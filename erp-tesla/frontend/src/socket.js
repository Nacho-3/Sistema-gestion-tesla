import { io } from 'socket.io-client'

const isViteDevServer = window.location.port === '5173'
const DEFAULT_SOCKET_URL = isViteDevServer
  ? `${window.location.protocol}//${window.location.hostname}:3000`
  : undefined
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || DEFAULT_SOCKET_URL

const socket = io(SOCKET_URL, {
  path: '/socket.io',
  autoConnect: false,
  withCredentials: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
})

socket.on('connect_error', (error) => {
  if (String(error?.message || '').toLowerCase().includes('sesión')) {
    socket.disconnect()
  }
})

export const connectAuthenticatedSocket = () => {
  if (!socket.connected) {
    socket.connect()
  }
}

export const disconnectSocket = () => {
  if (socket.connected) {
    socket.disconnect()
  }
}

export default socket
