import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Job } from '../jobs/job.entity';

export enum ArtifactType {
  VOLUME = 'volume',
  VOLUME_ISOTROPIC = 'volume_isotropic',
  MASK = 'mask',
  MESH_STL = 'mesh_stl',
  MESH_OBJ = 'mesh_obj',
  MESH_PLY = 'mesh_ply',
  MESH_GLB = 'mesh_glb',
  METADATA = 'metadata',
}

@Entity('models')
export class Model {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  jobId: string;

  @ManyToOne(() => Job, (job) => job.models)
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({
    type: 'enum',
    enum: ArtifactType,
  })
  type: ArtifactType;

  @Column()
  s3Key: string;

  @Column({ type: 'bigint', nullable: true })
  fileSize: number;

  @Column({ nullable: true })
  format: string; // stl, obj, ply, glb, nii.gz

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
