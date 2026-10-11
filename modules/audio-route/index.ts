import { requireOptionalNativeModule } from 'expo';

type EventSubscription = { remove: () => void };

export type AudioOutputType = 'bluetooth' | 'usb' | 'wired';

export type AudioOutputEvent = {
  name: string;
  type: AudioOutputType;
};

type AudioRouteEvents = {
  becomingNoisy: () => void;
  outputConnected: (event: AudioOutputEvent) => void;
  outputDisconnected: (event: AudioOutputEvent) => void;
};

type AudioRouteNativeModule = {
  addListener<EventName extends keyof AudioRouteEvents>(
    eventName: EventName,
    listener: AudioRouteEvents[EventName]
  ): EventSubscription;
};

const AudioRoute = requireOptionalNativeModule<AudioRouteNativeModule>('AudioRoute');

export function addAudioRouteListener<EventName extends keyof AudioRouteEvents>(
  eventName: EventName,
  listener: AudioRouteEvents[EventName]
): EventSubscription {
  return AudioRoute?.addListener(eventName, listener) ?? { remove: () => undefined };
}
