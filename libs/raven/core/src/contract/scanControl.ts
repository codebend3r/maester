import { isBoolean, object, type Infer } from '@/schema'

export const SCAN_CONTROL_PATH = '/api/admin/scans'
export const isScanControlState = object({ isStopped: isBoolean })
export type ScanControlState = Infer<typeof isScanControlState>
