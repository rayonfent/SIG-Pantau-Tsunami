declare module '*.css';

declare const process: {
  env: {
    REACT_APP_API_URL?: string;
    REACT_APP_WS_URL?: string;
  };
};
