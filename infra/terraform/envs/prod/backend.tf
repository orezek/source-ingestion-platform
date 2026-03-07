terraform {
  backend "gcs" {
    bucket = "omnicrawl-tfstate-001"
    prefix = "env/prod"
  }
}
