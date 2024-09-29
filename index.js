import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { PrismaClient } from '@prisma/client';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
  cors: {
    origin: "*",
  },
});

const prisma = new PrismaClient();
const a = await prisma.drawHistory.findMany({
  where: { userId: 'dffd8989-0384-4ec5-94af-fbdc4b0ff685 '},
})

// 메모리 내 상태 저장소
const boardStates = {};

io.on("connection", (socket) => {
  const { boardId } = socket.handshake.query;
  socket.join(boardId);  

  socket.on("client-ready", () => {
    const drawHistory = boardStates[boardId] || [];
    socket.emit("canvas-state-from-server", drawHistory);
  });

  socket.on("canvas-state", (state) => {
    boardStates[boardId] = state;
    socket.to(boardId).emit("canvas-state-from-server", state);
  });

  socket.on("draw-line", ({ prevPoint, currentPoint, color, userId }) => {
    const newDraw = {
      path: `M ${prevPoint.x} ${prevPoint.y} L ${currentPoint.x} ${currentPoint.y}`,
      color,
      userId,
    };
    if (!boardStates[boardId]) {
      boardStates[boardId] = [];
    }
    boardStates[boardId].push(newDraw);
    socket.to(boardId).emit("draw-line", { prevPoint, currentPoint, color, userId });
  });

  socket.on("undo", ({ newDrawHistory }) => {
    boardStates[boardId] = newDrawHistory;
    socket.to(boardId).emit("canvas-state-from-server", newDrawHistory);
  });

  socket.on("redo", ({ newDrawHistory }) => {
    boardStates[boardId] = newDrawHistory;
    socket.to(boardId).emit("canvas-state-from-server", newDrawHistory);
  });
});

server.listen(3001, () => {
  console.log("✔️ Server listening on port 3001");
});