import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server';

const fetchHandler = createStartHandler(defaultStreamHandler);

export default {
  fetch: fetchHandler,
};
