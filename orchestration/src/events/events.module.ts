import { Module } from '@nestjs/common';
import { ProgressGateway } from './progress.gateway';

@Module({
  providers: [ProgressGateway],
  exports: [ProgressGateway],
})
export class EventsModule {}
