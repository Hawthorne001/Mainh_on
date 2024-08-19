import type { DependencySource } from '../policy/variant-policy/variant-policy';

export type WorkspaceDependencyLifecycleType = 'runtime' | 'peer';

export type DependencyLifecycleType = WorkspaceDependencyLifecycleType | 'dev';

export interface SerializedDependency {
  id: string;
  version: string;
  versionRange?: string;
  __type: string;
  lifecycle: string;
  source?: DependencySource;
  hidden?: boolean;
  optional?: boolean;
  packageName?: string;
}

/**
 * Allowed values are valid semver values and the "-" sign.
 */
export type SemverVersion = string;
export type PackageName = string;

export type DependencyManifest = {
  packageName: PackageName;
  version: SemverVersion;
};

export interface Dependency {
  id: string;
  version: string;
  versionRange?: string;
  type: string;
  idWithoutVersion: string;
  lifecycle: DependencyLifecycleType;
  source?: DependencySource;
  hidden?: boolean;
  optional?: boolean;

  serialize: <T extends SerializedDependency>() => T;
  setVersion: (newVersion: string) => void;
  toManifest: () => DependencyManifest;
  getPackageName?: () => string;
}
