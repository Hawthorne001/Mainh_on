import { Artifact, ArtifactList } from '@teambit/builder';
import { AppBuildContext } from './app-build-context';

export class AppDeployContext extends AppBuildContext {
  constructor(
    /**
     * app build context.
     */
    appBuildContext: AppBuildContext,

    /**
     * artifacts generated upon component build.
     */
    readonly artifacts: ArtifactList<Artifact>,

    /**
     * public dir generated by the build.
     */
    readonly publicDir?: string,

    /**
     * ssr dir generated by the build.
     */
    readonly ssrPublicDir?: string
  ) {
    super(
      appBuildContext.appContext,
      appBuildContext.capsuleNetwork,
      appBuildContext.previousTasksResults,
      appBuildContext.pipeName,
      appBuildContext.capsule,
      appBuildContext.name,
      appBuildContext.appComponent,
      appBuildContext.artifactsDir,
      appBuildContext.laneId
    );
  }
}
