import * as path from 'path';
import { ComponentID } from '@teambit/component-id';
import { ExtensionDataList } from '../../consumer/config/extension-data';
import { PathOsBasedRelative } from '../path';
import componentIdToPackageName from './component-id-to-package-name';

export default function getNodeModulesPathOfComponent({
  bindingPrefix,
  id,
  defaultScope,
  extensions,
  isDependency = false,
}: {
  bindingPrefix?: string;
  id: ComponentID;
  defaultScope?: string | null;
  extensions: ExtensionDataList;
  isDependency?: boolean;
}): PathOsBasedRelative {
  const packageName = componentIdToPackageName({
    id,
    bindingPrefix,
    defaultScope,
    extensions,
    isDependency,
  });
  return path.join('node_modules', packageName);
}
