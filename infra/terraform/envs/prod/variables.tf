variable "project_id" {
  description = "Google Cloud project ID that owns the control-plane runtime resources."
  type        = string
}

variable "region" {
  description = "Default Google Cloud region for regional resources."
  type        = string
  default     = "europe-west3"
}

variable "bucket_location" {
  description = "Location used for GCS buckets."
  type        = string
  default     = "europe-west3"
}

variable "artifact_bucket_name" {
  description = "Globally unique GCS bucket for crawler HTML artifacts."
  type        = string
}

variable "structured_output_bucket_name" {
  description = "Globally unique GCS bucket for normalized JSON outputs."
  type        = string
}

variable "control_plane_pubsub_topic_name" {
  description = "Pub/Sub topic for brokered control-plane runtime events."
  type        = string
  default     = "omnicrawl-control-plane-events"
}

variable "force_destroy_buckets" {
  description = "Whether Terraform may destroy non-empty GCS buckets. Keep false in production."
  type        = bool
  default     = false
}
