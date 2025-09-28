/**
 * App-level components and providers
 */

export { ConnectionProvider } from './ConnectionProvider';
export type { ConnectionProviderProps, ConnectionContextType } from './ConnectionProvider';

export { 
  useConnectionContext,
  useConnectionStatus,
  useConnectionActions,
  useConnectionQueue,
  useConnectionError
} from './ConnectionProvider';