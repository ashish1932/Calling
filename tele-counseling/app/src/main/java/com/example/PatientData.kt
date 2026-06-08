package com.example

data class PatientData(
    val id: String,
    val name: String,
    val status: String?,
    val severity: String?,
    val avatarColor: String?,
    val progress: Int?,
    val phone: String? = null,
    val addictionCategory: String? = null,
    val assignedCounselor: String? = null,
    val cravingsIntensity: Int? = null,
    val nextOpdVisitDate: String? = null
)