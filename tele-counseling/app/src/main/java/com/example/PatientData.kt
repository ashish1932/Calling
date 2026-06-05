package com.example

data class PatientData(
    val id: String,
    val name: String,
    val status: String?,
    val severity: String?,
    val avatarColor: String?,
    val progress: Int?
)
