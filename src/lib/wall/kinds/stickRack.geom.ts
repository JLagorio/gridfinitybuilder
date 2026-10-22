import type { AttachmentBuilder } from '../build';
import { rackBody } from './bottleRack.geom';
import { stickSpec, type StickRackOptions } from './stickRack';

export const stickRackBuilder: AttachmentBuilder<StickRackOptions> = {
  body: (w, s, o, layout) => rackBody(w, s, stickSpec(o), layout),
};
