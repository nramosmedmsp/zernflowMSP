import { describe, expect, it } from "vitest";
import { uniqueChannelName } from "./realtime-channel";

describe("uniqueChannelName", () => {
  it("cada montaje del mismo chat usa un canal distinto (R2-B18)", () => {
    const a = uniqueChannelName("conversation-1");
    const b = uniqueChannelName("conversation-1");
    expect(a).not.toBe(b);
    expect(a.startsWith("conversation-1")).toBe(true);
  });
});
