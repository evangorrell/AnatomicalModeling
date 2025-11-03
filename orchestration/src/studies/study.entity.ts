import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Job } from '../jobs/job.entity';

@Entity('studies')
export class Study {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  seriesInstanceUID: string;

  @Column({ type: 'int', nullable: true })
  sliceCount: number;

  @Column({ nullable: true })
  modality: string;

  @Column({ nullable: true })
  seriesDescription: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column()
  s3Key: string; // Path to ZIP file in S3

  @Column()
  volumeS3Key: string; // Path to volume.nii.gz in S3

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Job, (job) => job.study)
  jobs: Job[];
}
