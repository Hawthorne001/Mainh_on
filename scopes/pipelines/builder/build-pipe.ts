import { EnvDefinition } from '@teambit/envs';
import { ComponentMap, ComponentID } from '@teambit/component';
import { Logger, LongProcessLogger } from '@teambit/logger';
import mapSeries from 'p-map-series';
import prettyTime from 'pretty-time';
import { capitalize } from '@teambit/toolbox.string.capitalize';
import chalk from 'chalk';
import { ArtifactFactory, ArtifactList, FsArtifact } from './artifact';
import { BuildContext, BuildTask, BuildTaskHelper, BuiltTaskResult } from './build-task';
import { ComponentResult } from './types';
import { TasksQueue } from './tasks-queue';
import { EnvsBuildContext } from './builder.service';
import { TaskResultsList } from './task-results-list';

export type TaskResults = {
  /**
   * task itself. useful for getting its id/description later on.
   */
  task: BuildTask;

  /**
   * environment were the task was running
   */
  env: EnvDefinition;

  /**
   * component build results.
   */
  componentsResults: ComponentResult[];

  /**
   * artifacts generated by the build pipeline.
   * in case the task finished with errors, this prop is undefined.
   */
  artifacts: ComponentMap<ArtifactList<FsArtifact>> | undefined;

  /**
   * timestamp of start initiation.
   */
  startTime: number;

  /**
   * timestamp of task completion.
   */
  endTime: number;
};

type PipeOptions = {
  exitOnFirstFailedTask?: boolean; // by default it skips only when a dependent failed.
  showEnvNameInOutput?: boolean;
  showEnvVersionInOutput?: boolean; // in case it shows the env-name, whether should show also the version
};

export class BuildPipe {
  private failedTasks: BuildTask[] = [];
  private failedDependencyTask: BuildTask | undefined;
  private longProcessLogger: LongProcessLogger;
  private taskResults: TaskResults[] = [];
  constructor(
    /**
     * array of services to apply on the components.
     */
    readonly tasksQueue: TasksQueue,
    readonly envsBuildContext: EnvsBuildContext,
    readonly logger: Logger,
    readonly artifactFactory: ArtifactFactory,
    private previousTaskResults?: TaskResults[],
    private options?: PipeOptions
  ) {}

  get allTasksResults(): TaskResults[] {
    return [...(this.previousTaskResults || []), ...(this.taskResults || [])];
  }

  /**
   * execute a pipeline of build tasks.
   */
  async execute(): Promise<TaskResultsList> {
    await this.executePreBuild();
    this.longProcessLogger = this.logger.createLongProcessLogger('running tasks', this.tasksQueue.length);
    await mapSeries(this.tasksQueue, async ({ task, env }) => this.executeTask(task, env));
    this.longProcessLogger.end();
    const capsuleRootDir = Object.values(this.envsBuildContext)[0]?.capsuleNetwork.capsulesRootDir;
    const tasksResultsList = new TaskResultsList(this.tasksQueue, this.taskResults, capsuleRootDir, this.logger);
    await this.executePostBuild(tasksResultsList);

    return tasksResultsList;
  }

  private async executePreBuild() {
    this.logger.setStatusLine('executing pre-build for all tasks');
    const longProcessLogger = this.logger.createLongProcessLogger('running pre-build for all tasks');
    await mapSeries(this.tasksQueue, async ({ task, env }) => {
      if (!task.preBuild) return;
      await task.preBuild(this.getBuildContext(env.id));
    });
    longProcessLogger.end();
  }

  private async executeTask(task: BuildTask, env: EnvDefinition): Promise<void> {
    const taskId = BuildTaskHelper.serializeId(task);
    const envName = this.options?.showEnvNameInOutput ? `(${this.getPrettyEnvName(env.id)}) ` : '';
    const buildContext = this.getBuildContext(env.id);
    const hasOriginalSeeders = Boolean(buildContext.capsuleNetwork._originalSeeders?.length);
    const dependencyStr = hasOriginalSeeders ? '' : `[dependency] `;
    const taskLogPrefix = `${dependencyStr}${envName}[${this.getPrettyAspectName(task.aspectId)}: ${task.name}]`;
    this.longProcessLogger.logProgress(`${taskLogPrefix}${task.description ? ` ${task.description}` : ''}`, false);
    this.updateFailedDependencyTask(task);
    if (this.shouldSkipTask(taskId, env.id)) {
      return;
    }
    const startTask = process.hrtime();
    const taskStartTime = Date.now();
    let buildTaskResult: BuiltTaskResult;
    try {
      buildTaskResult = await task.execute(buildContext);
    } catch (err) {
      this.logger.consoleFailure(`env: ${env.id}, task "${taskId}" threw an error`);
      throw err;
    }

    const endTime = Date.now();
    const compsWithErrors = buildTaskResult.componentsResults.filter((c) => c.errors?.length);
    let artifacts: ComponentMap<ArtifactList<FsArtifact>> | undefined;
    const duration = prettyTime(process.hrtime(startTask));
    if (compsWithErrors.length) {
      this.logger.consoleFailure(`env: ${env.id}, task "${taskId}" has failed`);
      this.logger.consoleFailure(
        chalk.red(`${this.longProcessLogger.getProgress()} env: ${env.id}, task "${taskId}" has failed in ${duration}`)
      );
      this.failedTasks.push(task);
    } else {
      const color = hasOriginalSeeders ? chalk.green : chalk.green.dim;
      this.logger.consoleSuccess(
        color(`${this.longProcessLogger.getProgress()} ${taskLogPrefix} Completed successfully in ${duration}`)
      );
      const defs = buildTaskResult.artifacts || [];
      artifacts = this.artifactFactory.generate(buildContext, defs, task);
    }

    const taskResults: TaskResults = {
      task,
      env,
      componentsResults: buildTaskResult.componentsResults,
      artifacts,
      startTime: taskStartTime,
      endTime,
    };

    this.taskResults.push(taskResults);
  }

  private getPrettyAspectName(aspectId: string): string {
    const resolvedId = ComponentID.fromString(aspectId);
    const tokens = resolvedId.name.split('-').map((token) => capitalize(token));
    return tokens.join(' ');
  }

  private getPrettyEnvName(envId: string) {
    const resolvedId = ComponentID.fromString(envId);
    const ver = this.options?.showEnvVersionInOutput ? `@${resolvedId.version}` : '';
    return `${resolvedId.fullName}${ver}`;
  }

  private async executePostBuild(tasksResults: TaskResultsList) {
    const longProcessLogger = this.logger.createLongProcessLogger('running post-build for all tasks');
    this.logger.setStatusLine('executing post-build for all tasks');
    await mapSeries(this.tasksQueue, async ({ task, env }) => {
      if (!task.postBuild) return;
      await task.postBuild(this.getBuildContext(env.id), tasksResults);
    });
    longProcessLogger.end();
  }

  private updateFailedDependencyTask(task: BuildTask) {
    if (!this.failedDependencyTask && this.failedTasks.length && task.dependencies) {
      task.dependencies.forEach((dependency) => {
        const { aspectId, name } = BuildTaskHelper.deserializeIdAllowEmptyName(dependency);
        this.failedDependencyTask = this.failedTasks.find((failedTask) => {
          if (name && name !== failedTask.name) return false;
          return aspectId === failedTask.aspectId;
        });
      });
    }
  }

  private shouldSkipTask(taskId: string, envId: string): boolean {
    if (this.options?.exitOnFirstFailedTask && this.failedTasks.length) {
      const failedTaskId = BuildTaskHelper.serializeId(this.failedTasks[0]);
      this.logger.consoleWarning(`env: ${envId}, task "${taskId}" has skipped due to "${failedTaskId}" failure`);
      return true;
    }
    if (!this.failedDependencyTask) return false;
    const failedTaskId = BuildTaskHelper.serializeId(this.failedDependencyTask);
    this.logger.consoleWarning(`env: ${envId}, task "${taskId}" has skipped due to "${failedTaskId}" failure`);
    return true;
  }

  private getBuildContext(envId: string): BuildContext {
    const buildContext = this.envsBuildContext[envId];
    if (!buildContext) throw new Error(`unable to find buildContext for ${envId}`);
    buildContext.previousTasksResults = this.allTasksResults;
    return buildContext;
  }
}
