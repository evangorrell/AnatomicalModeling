import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Study } from '../studies/study.entity';
import { Model } from '../models/model.entity';

export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum JobStage {
  QUEUED = 'queued',
  INGESTING = 'ingesting',
  RESAMPLING = 'resampling',
  SEGMENTING = 'segmenting',
  EXTRACTING_SURFACE = 'extracting_surface',
  POST_PROCESSING = 'post_processing',
  EXPORTING = 'exporting',
  UPLOADING = 'uploading',
  DONE = 'done',
}

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  studyId: string;

  @ManyToOne(() => Study, (study) => study.jobs)
  @JoinColumn({ name: 'studyId' })
  study: Study;

  @Column({
    type: 'enum',
    enum: JobStatus,
    default: JobStatus.PENDING,
  })
  status: JobStatus;

  @Column({
    type: 'enum',
    enum: JobStage,
    default: JobStage.QUEUED,
  })
  stage: JobStage;

  @Column({ type: 'int', default: 0 })
  progress: number; // 0-100

  @Column({ type: 'jsonb', nullable: true })
  params: {
    method?: 'classical' | 'unet';
    organ?: string;
    isoSpacing?: number;
    smooth?: {
      type: 'laplacian' | 'hc';
      iters: number;
    };
    export?: string[]; // ['stl', 'obj', 'ply']
  };

  @Column({ type: 'text', array: true, default: [] })
  logs: string[];

  @Column({ nullable: true })
  error: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  completedAt: Date;

  @OneToMany(() => Model, (model) => model.job)
  models: Model[];
}
