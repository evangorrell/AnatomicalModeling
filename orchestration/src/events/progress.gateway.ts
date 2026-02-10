import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
  namespace: '/progress',
})
export class ProgressGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger(ProgressGateway.name);

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, studyId: string): { event: string; data: { studyId: string } } {
    client.join(`study:${studyId}`);
    this.logger.log(`Client ${client.id} subscribed to study ${studyId}`);
    return { event: 'subscribed', data: { studyId } };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, studyId: string): { event: string; data: { studyId: string } } {
    client.leave(`study:${studyId}`);
    this.logger.log(`Client ${client.id} unsubscribed from study ${studyId}`);
    return { event: 'unsubscribed', data: { studyId } };
  }

  /**
   * Emit progress update to all clients subscribed to a study
   */
  emitProgress(studyId: string, progress: ProgressUpdate): void {
    this.server.to(`study:${studyId}`).emit('progress', progress);
    this.logger.debug(`Progress update for study ${studyId}: ${progress.percentage}% - ${progress.stage}`);
  }

  /**
   * Emit completion event
   */
  emitComplete(studyId: string, result: { studyId: string; status: string; meshes: string[] }): void {
    this.server.to(`study:${studyId}`).emit('complete', result);
    this.logger.log(`Study ${studyId} completed`);
  }

  /**
   * Emit error event
   */
  emitError(studyId: string, error: { message: string; details?: unknown }): void {
    this.server.to(`study:${studyId}`).emit('error', error);
    this.logger.error(`Study ${studyId} error: ${error.message}`);
  }
}

export interface ProgressUpdate {
  studyId: string;
  percentage: number; // 0-100
  stage: 'upload' | 'segmentation' | 'mesh_generation' | 'finalizing';
  message: string;
  timestamp: Date;
}
