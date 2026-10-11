import base64
import binascii
import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

MAX_IMAGE_BYTES = 5 * 1024 * 1024
DEFAULT_MATCH_THRESHOLD = 80.0
CORS_HEADERS = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
}

_rekognition_client = None
_dynamodb_resource = None


def _json_response(
    status_code: int, payload: dict[str, Any]
) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(payload),
    }


def _get_rekognition_client():
    global _rekognition_client
    if _rekognition_client is None:
        _rekognition_client = boto3.client("rekognition")
    return _rekognition_client


def _get_attendance_table():
    global _dynamodb_resource
    if _dynamodb_resource is None:
        _dynamodb_resource = boto3.resource("dynamodb")

    table_name = os.environ.get("ATTENDANCE_TABLE_NAME")
    if not table_name:
        raise RuntimeError("ATTENDANCE_TABLE_NAME is not configured")
    return _dynamodb_resource.Table(table_name)


def _parse_request_body(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body")
    if body is None:
        raise ValueError("Request body is required")

    if event.get("isBase64Encoded"):
        try:
            body = base64.b64decode(body).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as error:
            raise ValueError("Request body is not valid JSON") from error

    if isinstance(body, dict):
        payload = body
    elif isinstance(body, str):
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as error:
            raise ValueError("Request body is not valid JSON") from error
    else:
        raise ValueError("Request body must be a JSON object")

    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")
    return payload


def _decode_image(payload: dict[str, Any]) -> bytes:
    encoded_image = payload.get("image") or payload.get("imageBase64")
    if not isinstance(encoded_image, str) or not encoded_image.strip():
        raise ValueError("The image base64 string is required")

    if encoded_image.startswith("data:"):
        try:
            encoded_image = encoded_image.split(",", 1)[1]
        except IndexError as error:
            raise ValueError("The image data URL is invalid") from error

    try:
        image_bytes = base64.b64decode(encoded_image, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("The image is not valid base64") from error

    if not image_bytes:
        raise ValueError("The image cannot be empty")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError("The image must be 5 MB or smaller")
    return image_bytes


def _match_threshold() -> float:
    configured_threshold = os.environ.get(
        "MATCH_THRESHOLD", str(DEFAULT_MATCH_THRESHOLD)
    )
    try:
        threshold = float(configured_threshold)
    except ValueError as error:
        raise RuntimeError("MATCH_THRESHOLD is not a valid number") from error

    if not 0 <= threshold <= 100:
        raise RuntimeError("MATCH_THRESHOLD must be between 0 and 100")
    return threshold


def _record_attendance(face_match: dict[str, Any]) -> dict[str, Any]:
    face = face_match.get("Face", {})
    person_id = face.get("ExternalImageId") or face.get("FaceId")
    if not person_id:
        raise RuntimeError("Matched face has no identity")

    timestamp = datetime.now(timezone.utc).isoformat()
    attendance_id = str(uuid.uuid4())
    similarity = float(face_match.get("Similarity", 0))
    item = {
        "attendanceId": attendance_id,
        "Timestamp": timestamp,
        "ID": person_id,
        "Status": "PRESENT",
        "Similarity": Decimal(str(round(similarity, 4))),
    }
    _get_attendance_table().put_item(Item=item)
    return {
        "attendanceId": attendance_id,
        "personId": person_id,
        "timestamp": timestamp,
        "similarity": similarity,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    method = (
        event.get("httpMethod")
        or event.get("requestContext", {}).get("http", {}).get("method")
    )
    if method == "OPTIONS":
        return _json_response(200, {"success": True})
    if method and method != "POST":
        return _json_response(
            400, {"success": False, "message": "Only POST is supported"}
        )

    try:
        payload = _parse_request_body(event)
        image_bytes = _decode_image(payload)
        collection_id = os.environ.get("REKOGNITION_COLLECTION_ID")
        if not collection_id:
            raise RuntimeError("REKOGNITION_COLLECTION_ID is not configured")

        result = _get_rekognition_client().search_faces_by_image(
            CollectionId=collection_id,
            FaceMatchThreshold=_match_threshold(),
            Image={"Bytes": image_bytes},
            MaxFaces=1,
        )
        matches = result.get("FaceMatches", [])
        if not matches:
            return _json_response(
                200,
                {
                    "success": False,
                    "status": "NOT_RECOGNIZED",
                    "message": "Wajah tidak dikenali dalam koleksi terdaftar.",
                },
            )

        attendance = _record_attendance(matches[0])
        return _json_response(
            200,
            {
                "success": True,
                "status": "RECORDED",
                "message": "Absensi berhasil dicatat.",
                **attendance,
            },
        )
    except ValueError as error:
        return _json_response(400, {"success": False, "message": str(error)})
    except ClientError as error:
        error_code = error.response.get("Error", {}).get("Code", "")
        error_message = error.response.get("Error", {}).get("Message", "")
        if (
            error_code == "InvalidParameterException"
            and "face" in error_message.lower()
        ):
            return _json_response(
                200,
                {
                    "success": False,
                    "status": "NOT_RECOGNIZED",
                    "message": "Tidak ada wajah yang dapat dikenali.",
                },
            )
        service_error = {
            "success": False,
            "message": "Layanan verifikasi sedang bermasalah.",
        }
        return _json_response(
            500,
            service_error,
        )
    except (BotoCoreError, RuntimeError):
        service_error = {
            "success": False,
            "message": "Layanan verifikasi sedang bermasalah.",
        }
        return _json_response(
            500,
            service_error,
        )
