module.exports = {
  KubeConfig: class KubeConfig {
    loadFromDefault() {}
    makeApiClient() { return {}; }
  },
  CoreV1Api: class CoreV1Api {},
  NetworkingV1Api: class NetworkingV1Api {},
  V1Pod: class V1Pod {},
};
