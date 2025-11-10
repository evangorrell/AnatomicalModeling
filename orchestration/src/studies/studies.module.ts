import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { StudiesController } from './studies.controller';
import { StudiesService } from './studies.service';
import { StudiesProcessor } from './studies.processor';
import { Study } from './study.entity';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Study]),
    BullModule.registerQueue({
      name: 'studies',
    }),
    EventsModule,
  ],
  controllers: [StudiesController],
  providers: [StudiesService, StudiesProcessor],
  exports: [StudiesService],
})
export class StudiesModule {}
