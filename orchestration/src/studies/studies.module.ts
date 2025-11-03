import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudiesController } from './studies.controller';
import { StudiesService } from './studies.service';
import { Study } from './study.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Study])],
  controllers: [StudiesController],
  providers: [StudiesService],
  exports: [StudiesService],
})
export class StudiesModule {}
