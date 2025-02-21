import express, { Response, Request } from "express";
import dotenv from "dotenv";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import path from "path";
import { SocketEvent, SocketId } from "./types/socket";
import { USER_CONNECTION_STATUS, User } from "./types/user";

// Load environment variables
dotenv.config();

const app = express();

// CORS configuration
app.use(
  cors({
    origin: ["https://code-driver.onrender.com"], // Allow only frontend origin
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../public"))); // Ensure correct static file path

// Create HTTP Server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://code-driver.onrender.com"], // Match CORS settings
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
});

let userSocketMap: User[] = [];

function getUsersInRoom(roomId: string): User[] {
  return userSocketMap.filter((user) => user.roomId === roomId);
}

function getRoomId(socketId: SocketId): string | null {
  return userSocketMap.find((user) => user.socketId === socketId)?.roomId || null;
}

function getUserBySocketId(socketId: SocketId): User | null {
  return userSocketMap.find((user) => user.socketId === socketId) || null;
}

io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  socket.on(SocketEvent.JOIN_REQUEST, ({ roomId, username }) => {
    if (getUsersInRoom(roomId).some((u) => u.username === username)) {
      io.to(socket.id).emit(SocketEvent.USERNAME_EXISTS);
      return;
    }

    const user: User = {
      username,
      roomId,
      status: USER_CONNECTION_STATUS.ONLINE,
      cursorPosition: 0,
      typing: false,
      socketId: socket.id,
      currentFile: null,
    };

    userSocketMap.push(user);
    socket.join(roomId);
    socket.broadcast.to(roomId).emit(SocketEvent.USER_JOINED, { user });
    io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, { user, users: getUsersInRoom(roomId) });
  });

  socket.on("disconnecting", () => {
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;
    socket.broadcast.to(roomId).emit(SocketEvent.USER_DISCONNECTED, { user });
    userSocketMap = userSocketMap.filter((u) => u.socketId !== socket.id);
    socket.leave(roomId);
  });

  socket.on(SocketEvent.SEND_MESSAGE, ({ message }) => {
    const roomId = getRoomId(socket.id);
    if (roomId) {
      socket.broadcast.to(roomId).emit(SocketEvent.RECEIVE_MESSAGE, { message });
    }
  });

  socket.on(SocketEvent.USER_OFFLINE, ({ socketId }) => {
    userSocketMap = userSocketMap.map((user) =>
      user.socketId === socketId ? { ...user, status: USER_CONNECTION_STATUS.OFFLINE } : user
    );
    const roomId = getRoomId(socketId);
    if (roomId) {
      socket.broadcast.to(roomId).emit(SocketEvent.USER_OFFLINE, { socketId });
    }
  });

  socket.on(SocketEvent.USER_ONLINE, ({ socketId }) => {
    userSocketMap = userSocketMap.map((user) =>
      user.socketId === socketId ? { ...user, status: USER_CONNECTION_STATUS.ONLINE } : user
    );
    const roomId = getRoomId(socketId);
    if (roomId) {
      socket.broadcast.to(roomId).emit(SocketEvent.USER_ONLINE, { socketId });
    }
  });
});

const PORT = process.env.PORT || 5000;

app.get("/", (req: Request, res: Response) => {
  res.sendFile(path.resolve(__dirname, "../public/index.html"));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
