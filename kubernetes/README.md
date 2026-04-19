# Kubernetes Templates

This directory contains templates for deploying Spectrum KNX on Kubernetes.

## Prerequisites

1. A Kubernetes cluster.
2. An Ingress controller (e.g., NGINX, Traefik).
3. (Optional) A default StorageClass if you don't want to use the provided PV templates.

## Deployment Steps

1. **Configure Secrets**: Edit `spectrumknx-secret.yaml` and set your passwords.
   ```bash
   kubectl apply -f spectrumknx-secret.yaml
   ```

2. **Setup Storage**:
   If you don't have a dynamic provisioner, edit `timescaledb-volume.yaml` and `knxproj-volume.yaml` to point to your actual storage paths, then apply them along with the claims:
   ```bash
   kubectl apply -f timescaledb-volume.yaml
   kubectl apply -f timescaledb-volume-claim.yaml
   kubectl apply -f knxproj-volume.yaml
   kubectl apply -f knxproj-volume-claim.yaml
   ```

3. **Deploy TimescaleDB**:
   ```bash
   kubectl apply -f timescaledb-service.yaml
   kubectl apply -f timescaledb-sts.yaml
   ```

4. **Deploy Spectrum KNX**:
   Edit `spectrumknx-sts.yaml` and set your `KNX_GATEWAY_IP` and `KNX_PROJECT_PATH`.
   ```bash
   kubectl apply -f spectrumknx-service.yaml
   kubectl apply -f spectrumknx-sts.yaml
   ```

5. **Expose the App**:
   Edit `spectrumknx-ingress.yaml` and set your desired `host`.
   ```bash
   kubectl apply -f spectrumknx-ingress.yaml
   ```