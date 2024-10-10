import express from "express";
import { Server } from "socket.io";
import http from "http";
import { PrismaClient, Prisma, DrawHistory } from "@prisma/client";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const prisma = new PrismaClient();

const boardStates: Record<string, DrawHistory[]> = {};
const userDrawHistories: Record<string, Record<string, DrawHistory[]>> = {};
const userRedoHistories: Record<string, Record<string, DrawHistory[]>> = {};

// 클라이언트가 보드에 접속할 때 보드 상태를 전달하고, 기록을 유지함
io.on("connection", async (socket) => {
  socket.on("join-board", async ({ boardId, userId }) => {
    if (!userDrawHistories[boardId]) {
      userDrawHistories[boardId] = {};
    }
    if (!userRedoHistories[boardId]) {
      userRedoHistories[boardId] = {};
    }
    if (!userDrawHistories[boardId][userId]) {
      userDrawHistories[boardId][userId] = [];
    }
    if (!userRedoHistories[boardId][userId]) {
      userRedoHistories[boardId][userId] = [];
    }

    if (!boardStates[boardId]) {
      boardStates[boardId] = await prisma.drawHistory.findMany({
        where: { boardId },
      });
    }

    socket.join(boardId);
    socket.emit("canvas-state-from-server", boardStates[boardId] || []);
  });

  socket.on("draw", async ({ boardId, userId, path, color, bounds }) => {
    try {
      const newDraw = await prisma.drawHistory.create({
        data: {
          boardId,
          userId,
          path: path as Prisma.InputJsonValue,
          color,
          bounds: bounds as Prisma.InputJsonValue,
        },
      });

      if (!boardStates[boardId]) {
        boardStates[boardId] = [];
      }
      boardStates[boardId].push(newDraw);

      if (!userDrawHistories[boardId][userId]) {
        userDrawHistories[boardId][userId] = [];
      }
      userDrawHistories[boardId][userId].push(newDraw);

      // 새로운 그리기가 추가될 때 redo 히스토리 초기화
      userRedoHistories[boardId][userId] = [];

      io.to(boardId).emit("canvas-state-from-server", boardStates[boardId]);
      socket.emit("draw-complete", newDraw);
    } catch (error) {
      console.error("그림 저장 오류:", error);
    }
  });

  socket.on("redo", async ({ boardId, userId }) => {
    const redoHistory = userRedoHistories[boardId][userId];
    if (!redoHistory || redoHistory.length === 0) {
      socket.emit("error", "다시 실행할 작업이 없습니다.");
      return;
    }

    const lastRedo = redoHistory.pop();
    if (!lastRedo) return;

    boardStates[boardId].push(lastRedo);
    userDrawHistories[boardId][userId].push(lastRedo);

    try {
      const drawRecord = await prisma.drawHistory.findUnique({
        where: { id: lastRedo.id },
      });

      if (!drawRecord) {
        await prisma.drawHistory.create({
          data: {
            id: lastRedo.id,
            boardId: lastRedo.boardId,
            userId: lastRedo.userId,
            path: lastRedo.path as Prisma.InputJsonValue,
            color: lastRedo.color,
            bounds: lastRedo.bounds as Prisma.InputJsonValue,
            createdAt: lastRedo.createdAt,
          },
        });
      }

      io.to(boardId).emit("canvas-state-from-server", boardStates[boardId]);
    } catch (error) {
      console.error("redo 작업 중 오류 발생:", error);
      socket.emit("error", "다시 실행 작업 중 오류가 발생했습니다.");
    }
  });

  socket.on("undo", async ({ boardId, userId }) => {
    const userHistory = userDrawHistories[boardId][userId];
    if (!userHistory || userHistory.length === 0) {
      socket.emit("error", "되돌릴 작업이 없습니다.");
      return;
    }

    const lastDraw = userHistory.pop();
    if (!lastDraw) return;

    boardStates[boardId] = boardStates[boardId].filter((draw) => draw.id !== lastDraw.id);

    if (!userRedoHistories[boardId][userId]) {
      userRedoHistories[boardId][userId] = [];
    }
    userRedoHistories[boardId][userId].push(lastDraw);

    try {
      await prisma.drawHistory.delete({
        where: { id: lastDraw.id },
      });

      io.to(boardId).emit("canvas-state-from-server", boardStates[boardId]);
    } catch (error) {
      console.error("undo 작업 중 오류 발생:", error);
      socket.emit("error", "되돌리기 작업 중 오류가 발생했습니다.");
    }
  });
});

server.listen(3001, () => {
  console.log("서버가 3001 포트에서 실행 중입니다.");
});