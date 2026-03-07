provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  labels = {
    app         = "omnicrawl"
    environment = "prod"
    managed_by  = "terraform"
  }
}

resource "google_storage_bucket" "artifacts" {
  name          = var.artifact_bucket_name
  location      = var.bucket_location
  force_destroy = var.force_destroy_buckets
  labels        = local.labels

  uniform_bucket_level_access = true
}

resource "google_storage_bucket" "structured_output" {
  name          = var.structured_output_bucket_name
  location      = var.bucket_location
  force_destroy = var.force_destroy_buckets
  labels        = local.labels

  uniform_bucket_level_access = true
}

resource "google_pubsub_topic" "control_plane_events" {
  name   = var.control_plane_pubsub_topic_name
  labels = local.labels
}
