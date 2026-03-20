import { io } from 'socket.io-client'

const isViteDevServer = window.location.port === '5173'
const DEFAULT_SOCKET_URL = isViteDevServer
  ? `${window.location.protocol}//${window.location.hostname}:3000`
  : undefined
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || DEFAULT_SOCKET_URL

const socket = io(SOCKET_URL, {
  path: '/socket.io',
  autoConnect: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
})

export default socket
