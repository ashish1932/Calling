import os

dialogue = [
    ("en-US-JennyNeural", "Hello Gurpreet, I am Dr. Amanpreet calling from the Punjab Tele-Counseling center. How are you feeling today?"),
    ("en-IN-NeerjaNeural", "Sat Sri Akal doctor. I am feeling very anxious. The cravings have been very strong since yesterday."),
    ("en-US-JennyNeural", "I understand, Gurpreet. Experiencing cravings is a normal part of the recovery process. Have you been taking your prescribed buprenorphine dosage?"),
    ("en-IN-NeerjaNeural", "Yes, I took the morning dose. But it feels like it is not enough. I am having trouble sleeping as well."),
    ("en-US-JennyNeural", "It is good that you are sticking to your medication. Sleep disturbances are common in this stage. I want you to try the grounding exercises we discussed last week. Can you do that for me?"),
    ("en-IN-NeerjaNeural", "I will try, doctor. It is just very hard when the anxiety hits."),
    ("en-US-JennyNeural", "You are doing incredibly well. Remember, you have been sober for 20 days now. That is a huge achievement. I am going to schedule a follow-up call for tomorrow morning to check on you. If the anxiety gets worse, please reach out to your local DDRC immediately."),
    ("en-IN-NeerjaNeural", "Okay doctor. Thank you for calling. I feel a bit better just talking about it."),
    ("en-US-JennyNeural", "You are very welcome, Gurpreet. Stay strong, and I will speak to you tomorrow. Take care.")
]

for i, (voice, text) in enumerate(dialogue):
    os.system(f'edge-tts --voice {voice} --text "{text}" --write-media part_{i}.mp3')

files = "+".join([f"part_{i}.mp3" for i in range(len(dialogue))])
os.system(f"copy /b {files} assets\\audio\\demo.mp3")

# cleanup
for i in range(len(dialogue)):
    if os.path.exists(f"part_{i}.mp3"):
        os.remove(f"part_{i}.mp3")

print("Generated assets/audio/demo.mp3")
