terraform {
  backend "gcs" {
    bucket = "jobcompass-tfstate-001" # your bucket name
    prefix = "env/prod"
  }
}
