import { io, type Socket } from 'socket.io-client'
import type { ClientToServer, ServerToClient } from '../../shared/events.ts'
import { Clock } from '../sync/clock.ts'

export const socket: Socket<ServerToClient, ClientToServer> = io()
export const clock = new Clock(() => new Promise(resolve => socket.emit('clock:ping', resolve)))
