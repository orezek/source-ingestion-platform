# Terraform Infrastructure

This directory contains Terraform configuration for infrastructure managed outside application runtime code.

## Layout

- `envs/`: root modules per environment (for example `prod`)
- `modules/`: reusable Terraform modules

## Getting Started

1. Install Terraform.
2. Create the backend bucket (`jobcompass-tfstate-001`) in GCS.
3. Run Terraform from an environment directory, for example:

```bash
cd infra/terraform/envs/prod
terraform init
terraform plan
```

## Notes

- The GCS backend is configured in `envs/prod/backend.tf`.
- Do not commit local state files or `.terraform/` directories.
