import { style } from '@vanilla-extract/css';

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  height: '100%',
  minHeight: 300,
  minWidth: 0,
  overflow: 'hidden',
});

export const canvas = style({
  flex: 1,
  minHeight: 0,
  position: 'relative',
});

export const notice = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  padding: '8px 16px',
  fontSize: 13,
});
