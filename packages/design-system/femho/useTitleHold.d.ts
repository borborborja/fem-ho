import type { HTMLAttributes, RefObject } from 'react';

export declare function useTitleHold(onEdit?: () => void): {
  suppressClick: RefObject<boolean>;
  titleProps: HTMLAttributes<HTMLSpanElement>;
};
