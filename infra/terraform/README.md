# Terraform Infrastructure

This directory contains Terraform configuration for infrastructure managed outside application runtime code.

## Layout

- `envs/`: root modules per environment (for example `prod`)
- `modules/`: reusable Terraform modules

## Getting Started

1. Install Terraform.
2. Create the backend bucket (`omnicrawl-tfstate-001`) in GCS.
3. Copy the environment example file and set real values:

```bash
cd infra/terraform/envs/prod
cp prod.tfvars.example prod.tfvars
```

4. Run Terraform from an environment directory, for example:

```bash
cd infra/terraform/envs/prod
terraform init
terraform plan -var-file=prod.tfvars
```

## Notes

- The GCS backend is configured in `envs/prod/backend.tf`.
- The prod root module provisions:
  - one GCS bucket for crawler HTML artifacts
  - one GCS bucket for structured JSON outputs
  - one Pub/Sub topic for brokered runtime events
- Do not commit local state files or `.terraform/` directories.
