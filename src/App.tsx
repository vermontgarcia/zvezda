/* eslint-disable @typescript-eslint/no-explicit-any */
import './App.css';
import { useEffect, useRef, useState } from 'react';

const App = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [interim, setInterim] = useState<string>('');
  // const [error, console.error] = useState<string | null>(null);

  // useEffect(() => {
  //   const element = document.documentElement;
  //   if (element.requestFullscreen) {
  //     element.requestFullscreen();
  //   }
  // }, []);

  useEffect(() => {
    // Setup webcam + mic
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        console.error(err);
        console.error('Could not access media devices.');
      });

    // Setup Web Speech API for transcription
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error('Web Speech API is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'es-ES'; // Set source language (e.g., "es-ES" for Spanish)

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (finalTranscript) {
        setTranscripts((prev) => [...prev, finalTranscript.trim()]);
        setInterim('');
      } else {
        setInterim(interimTranscript.trim());
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50); // slight delay ensures render completes
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech') {
        console.error('Speech recognition error:', event);
      }
      console.error('Speech recognition error.');
      // console.log(error);
    };

    recognition.start();

    recognition.onend = () => {
      console.log('Recognition stopped. Restarting...');
      setTimeout(() => {
        recognition.start(); // Restart automatically on silence
      }, 250);
    };

    return () => {
      recognition.stop();
      recognition.onend = null; // Clean up on unmount
    };
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
      }}
    >
      <button
        onClick={() => {
          const element = document.documentElement;
          if (element.requestFullscreen) {
            element.requestFullscreen();
          } else if ((element as any).webkitRequestFullscreen) {
            (element as any).webkitRequestFullscreen(); // Safari
          }
        }}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          zIndex: 10,
          padding: '0.5rem 1rem',
          fontSize: '1rem',
        }}
      >
        Toggle Fullscreen
      </button>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          zIndex: -1, // push behind text if needed
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: '1rem',
          bottom: '1rem',
          padding: '0 1rem',
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none', // IE 10+
          overscrollBehavior: 'contain',
          maxHeight: '30%',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          backgroundColor: 'transparent',
          textAlign: 'end',
          maxWidth: '50%',
          color: 'yellow',
          fontSize: '1rem',
          zIndex: 1,
          // Gradient mask
          WebkitMaskImage:
            'linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0))',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0))',
          textShadow: '2px 2px 2px black',
        }}
      >
        {transcripts.map((line, index) => (
          <p style={{ margin: '0' }} key={index}>
            {line}
          </p>
        ))}
        {interim && <p style={{ opacity: 0.6, margin: '0' }}>{interim}</p>}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default App;
