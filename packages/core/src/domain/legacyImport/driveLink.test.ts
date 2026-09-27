import { describe, expect, it } from 'vitest';
import { driveFileIdOfLink } from './driveLink';

describe('driveFileIdOfLink(Google ドライブの URL のファイル ID)', () => {
  it('GAS版の file.getUrl() の形と open?id= / uc?id= の形を読む', () => {
    expect(driveFileIdOfLink('https://drive.google.com/file/d/1AbC_def-GHIjkl012/view?usp=drivesdk')).toBe(
      '1AbC_def-GHIjkl012',
    );
    expect(driveFileIdOfLink(' https://drive.google.com/open?id=1AbC_def-GHIjkl012 ')).toBe(
      '1AbC_def-GHIjkl012',
    );
    expect(driveFileIdOfLink('https://docs.google.com/uc?export=download&id=1AbC_def-GHIjkl012')).toBe(
      '1AbC_def-GHIjkl012',
    );
  });

  it('Google ドライブ以外・ID の無い URL・URL でない値は null', () => {
    expect(driveFileIdOfLink('https://example.com/file/d/1AbC_def-GHIjkl012/view')).toBeNull();
    expect(driveFileIdOfLink('http://drive.google.com/file/d/1AbC_def-GHIjkl012/view')).toBeNull();
    expect(driveFileIdOfLink('https://drive.google.com/drive/folders')).toBeNull();
    expect(driveFileIdOfLink('写真')).toBeNull();
    expect(driveFileIdOfLink('')).toBeNull();
  });
});
