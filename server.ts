import express from "express";
import { Server } from "socket.io";
import http from "http";
import { DrawHistory, PrismaClient } from "@prisma/client";

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
    // boardId와 userId의 기록을 초기화하지 않고 유지
    if (!userDrawHistories[boardId]) {
      userDrawHistories[boardId] = {}; // boardId가 없으면 빈 객체로 초기화
    }
    if (!userRedoHistories[boardId]) {
      userRedoHistories[boardId] = {}; // boardId가 없으면 빈 객체로 초기화
    }
    if (!userDrawHistories[boardId][userId]) {
      userDrawHistories[boardId][userId] = []; // userId가 없으면 빈 배열로 초기화
    }
    if (!userRedoHistories[boardId][userId]) {
      userRedoHistories[boardId][userId] = []; // userId가 없으면 빈 배열로 초기화
    }

    // 서버에서 보드에 대한 기존 상태(그리기 기록)를 가져옴
    if (!boardStates[boardId]) {
      boardStates[boardId] = await prisma.drawHistory.findMany({
        where: { boardId },
      });
    }

    // 클라이언트에 기존 보드 상태 전달
    socket.join(boardId);
    socket.emit("canvas-state-from-server", boardStates[boardId] || []);
  });

  socket.on("draw", async ({ boardId, userId, path, color }) => {
    try {
      // 새 그리기 기록을 데이터베이스에 저장 (id는 서버에서 생성)
      const newDraw = await prisma.drawHistory.create({
        data: {
          boardId,
          userId,
          path,
          color,
        },
      });
  
      // 서버의 상태에도 새 그림 기록 추가
      if (!boardStates[boardId]) {
        boardStates[boardId] = [];
      }
      boardStates[boardId].push(newDraw);
  
      if (!userDrawHistories[boardId][userId]) {
        userDrawHistories[boardId][userId] = [];
      }
      userDrawHistories[boardId][userId].push(newDraw);
  
      // 클라이언트에게 업데이트된 보드 상태 및 id 전송
      io.to(boardId).emit("canvas-state-from-server", boardStates[boardId]);
      socket.emit("draw-complete", newDraw);  // 클라이언트로 id 포함하여 전송
    } catch (error) {
      console.error("그림 저장 오류:", error);
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

    // 서버와 메모리에서 상태 제거
    boardStates[boardId] = boardStates[boardId].filter(
      (draw) => draw.id !== lastDraw.id
    );
    if (!userRedoHistories[boardId][userId]) {
      userRedoHistories[boardId][userId] = [];
    }
    userRedoHistories[boardId][userId].push(lastDraw);

    try {
      // 데이터베이스에서도 해당 기록 삭제
      await prisma.drawHistory.delete({
        where: { id: lastDraw.id },
      });

      io.to(boardId).emit("canvas-state-from-server", boardStates[boardId]);
    } catch (error) {
      console.error("undo 작업 중 오류 발생:", error);
      socket.emit("error", "되돌리기 작업 중 오류가 발생했습니다.");
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
          data: lastRedo,
        });
      } else {
        console.warn(`기록이 이미 존재합니다: ${lastRedo.id}`);
      }

      io.to(boardId).emit("canvas-state-from-server", boardStates[boardId]);
    } catch (error) {
      console.error("redo 작업 중 오류 발생:", error);
      socket.emit("error", "다시 실행 작업 중 오류가 발생했습니다.");
    }
  });
});

server.listen(3001, () => {
  console.log("서버가 3001 포트에서 실행 중입니다.");
});
