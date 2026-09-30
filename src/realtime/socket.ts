import { io, type Socket } from 'socket.io-client'
import type { ClientToServer, ServerToClient } from '../../shared/events.ts'
import { Clock } from '../sync/clock.ts'

export const socket: Socket<ServerToClient, ClientToServer> = io()
export const clock = new Clock(() => new Promise(resolve => socket.emit('clock:ping', resolve)))

// Owns long-lived side effects (sockets, timers, <audio>); a full reload is safer than hot-swapping.
import.meta.hot?.dispose(() => location.reload())
