import { useMemo } from 'react';

import { getVideoFeed } from '@/services/videos/video-service';

export function useVideoFeed() {
  return useMemo(() => getVideoFeed(), []);
}
