import requests
import json
import time

assignment_id = "18597059"
student_id = "stu_ai_grader_test"

submission_text = """
# AI Solution for Healthcare Diagnostics

## Introduction
The healthcare industry is facing unprecedented challenges with increasing patient loads and diagnostic errors. This paper proposes an AI solution to assist radiologists in diagnosing lung cancer from X-ray imaging.

## Literature Review
Previous studies have shown that Convolutional Neural Networks (CNNs) achieve high accuracy in image recognition. Smith et al. (2022) demonstrated an 85% accuracy rate using ResNet-50. However, most models struggle with rare anomalies.

## AI Solution
We propose a hybrid model combining CNNs with a Vision Transformer (ViT) architecture. This approach captures both local features (like small nodules) and global context (the overall lung structure). The model is trained on a dataset of 50,000 labeled chest X-rays.

## Methodology
The dataset is split into 70% training, 15% validation, and 15% testing. We preprocess images using CLAHE for contrast enhancement. The model uses a learning rate of 0.001 with Adam optimizer. Performance is measured using F1-score and AUC-ROC.

## Ethical Considerations
Patient data privacy is paramount. All X-rays are fully anonymized. Furthermore, to prevent algorithmic bias, the dataset includes diverse demographic groups. The AI is designed as a decision-support tool, not a replacement for human doctors.

## Expected Outcomes/Results
We expect the model to achieve an AUC-ROC of at least 0.92, outperforming existing CNN-only models. Preliminary testing shows a 15% reduction in false negative rates compared to human baselines.

## Challenges and Solutions
A major challenge is data scarcity for specific lung conditions. To solve this, we employ data augmentation techniques such as rotation, zooming, and Generative Adversarial Networks (GANs) to synthesize rare cases.

## Conclusion and Future Work
This hybrid AI approach offers a promising way to improve lung cancer detection. Future work will involve clinical trials in real hospital environments and expanding the model to other imaging modalities like MRI.
"""

payload = {
    "assignment_id": assignment_id,
    "student_id": student_id,
    "submission_text": submission_text
}

print("Triggering RAG grading server on port 5557...")
start = time.time()
try:
    response = requests.post("http://localhost:5557/api/grade", json=payload, timeout=300)
    if response.status_code == 200:
        data = response.json()
        print(f"Success! Took {round(time.time() - start, 2)}s")
        with open("rag_grading_result.json", "w") as f:
            json.dump(data, f, indent=2)
        print("Result saved to rag_grading_result.json")
    else:
        print(f"Error {response.status_code}: {response.text}")
except Exception as e:
    print(f"Exception: {e}")
