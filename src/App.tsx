/* eslint-disable @typescript-eslint/no-explicit-any */
import './App.css';
import { useEffect, useRef, useState } from 'react';
import { WS_SERVER_URL } from './utils/const.env';

const signalingServerUrl = `${WS_SERVER_URL}`; // Change if needed

const App = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const recognitionRef = useRef<any | null>(null);
  const startedRef = useRef<boolean>(false);

  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [interim, setInterim] = useState<string>('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [videoSource, setVideoSource] = useState(true);
  const [started, setStarted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    console.log(navigator.languages);
    console.log(navigator.language);
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (videoRef.current) videoRef.current.srcObject = stream;
        setLocalStream(stream);
      })
      .catch((err) => {
        console.error('Could not access media devices.', err);
      });

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error('Web Speech API is not supported in this browser.');
      return;
    }

    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = 'ru-RU';

    recognitionRef.current.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i];
        if (result.isFinal) finalTranscript += result[0].transcript;
        else interimTranscript += result[0].transcript;
      }

      if (finalTranscript) {
        setTranscripts((prev) => [...prev, finalTranscript.trim()]);
        setInterim('');
      } else {
        setInterim(interimTranscript.trim());
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
      }
    };

    recognitionRef.current.onerror = (event: any) => {
      if (event.error !== 'no-speech')
        console.error('Speech recognition error:', event);
    };

    // recognitionRef.current.start();
    recognitionRef.current.onend = () => {
      if (startedRef.current) {
        console.log('Recognition stopped. Restarting...');
        setTimeout(() => recognitionRef.current.start(), 2500);
      } else {
        console.log('Recognition stopped. Not restarting!');
      }
    };

    return () => {
      recognitionRef.current.stop();
      recognitionRef.current.onend = null;
    };
  }, []);

  useEffect(() => {
    ws.current = new WebSocket(signalingServerUrl);

    ws.current.onopen = () => {
      console.log('Connected to signaling server');
    };

    ws.current.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.current.onmessage = async (message) => {
      const data = JSON.parse(message.data);

      switch (data.type) {
        case 'offer':
          console.log('Received offer:', data.offer);
          await handleOffer(data.offer);
          break;
        case 'answer':
          console.log('Received answer:', data.answer);
          await peerConnectionRef.current?.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
          break;
        case 'ice-candidate':
          console.log('Received ICE candidate:', data.candidate);
          await peerConnectionRef.current?.addIceCandidate(data.candidate);
          break;
        default:
          console.warn('Unknown message type:', data.type);
      }
    };

    return () => {
      ws.current?.close();
    };
  }, []);

  const createPeerConnection = () => {
    if (!localStream) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(
          JSON.stringify({ type: 'ice-candidate', candidate: event.candidate })
        );
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    };

    peerConnectionRef.current = pc;
    console.log('Peer connection created');
  };

  const callRemotePeer = async () => {
    if (!peerConnectionRef.current) createPeerConnection();
    const pc = peerConnectionRef.current;
    if (!pc) return;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'offer', offer }));
    }
    console.log('Offer sent:', offer);
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit) => {
    if (!peerConnectionRef.current) createPeerConnection();
    const pc = peerConnectionRef.current;
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'answer', answer }));
    }
    console.log('Answer sent:', answer);
  };

  const toogleVideo = () => {
    console.log('click', videoSource);
    console.log('click', !videoSource);
    setVideoSource(!videoSource);
  };

  const startRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.start();
    }
  };

  const stopRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  const toogleRecognition = () => {
    if (startedRef.current) {
      stopRecognition();
    } else {
      startRecognition();
    }
    startedRef.current = !startedRef.current;
    setStarted(!started);
  };

  const restartRecognition = () => {
    stopRecognition();
    setTimeout(() => {
      startRecognition();
    }, 500);
  };

  const setRussian = () => {
    recognitionRef.current.lang = 'ru-RU';
    if (started) {
      restartRecognition();
    }
  };

  const setSpanish = () => {
    recognitionRef.current.lang = 'es-MX';
    if (started) {
      restartRecognition();
    }
  };

  const showModal = () => {
    setOpen(true);
    setTimeout(() => {
      setOpen(false);
    }, 5000);
  };

  // const videoStyles = {
  //   position: 'absolute',
  //   bottom: 20,
  //   left: 20,
  //   width: '100px',
  //   height: '150px',
  //   objectFit: 'cover',
  //   zIndex: 1,
  //   borderRadius: '10px',
  //   border: '2px solid white',
  // };

  // const remoteVideoStyles = {
  //   position: 'absolute',
  //   top: 0,
  //   left: 0,
  //   width: '100vw',
  //   height: '100vh',
  //   objectFit: 'cover',
  //   zIndex: -1,
  // };

  return (
    <div
      onClick={showModal}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        onClick={toogleVideo}
        style={
          videoSource
            ? {
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                objectFit: 'cover',
                zIndex: -1,
              }
            : {
                position: 'absolute',
                bottom: 20,
                left: 20,
                width: '100px',
                height: '150px',
                objectFit: 'cover',
                zIndex: 1,
                borderRadius: '10px',
                border: '2px solid white',
              }
        }
      />
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        onClick={toogleVideo}
        style={
          videoSource
            ? {
                position: 'absolute',
                bottom: 20,
                left: 20,
                width: '100px',
                height: '150px',
                objectFit: 'cover',
                zIndex: 1,
                borderRadius: '10px',
                border: '2px solid white',
              }
            : {
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                objectFit: 'cover',
                zIndex: -1,
              }
        }
      />

      {started && (
        <div
          style={{
            position: 'absolute',
            right: '1rem',
            bottom: '1rem',
            padding: '0 1rem',
            maxHeight: '30%',
            overflowY: 'auto',
            backgroundColor: 'transparent',
            textAlign: 'end',
            maxWidth: '50%',
            color: 'yellow',
            fontSize: '1rem',
            zIndex: 1,
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
      )}

      <dialog
        open={open}
        style={{
          border: '1px solid red',
          width: '90%',
          height: '94.5%',
          zIndex: 10,
          backgroundColor: 'transparent',
        }}
      >
        <button
          onClick={() => {
            const element = document.documentElement;
            if (element.requestFullscreen) element.requestFullscreen();
            else if ((element as any).webkitRequestFullscreen)
              (element as any).webkitRequestFullscreen();
          }}
          style={{ position: 'absolute', top: 20, right: 20, zIndex: 10 }}
        >
          Toggle Fullscreen
        </button>

        {/* <button
          onClick={createPeerConnection}
          style={{ position: 'absolute', top: '5rem', left: '20px', zIndex: 10 }}
        >
          Start Call
        </button> */}
        <button
          onClick={callRemotePeer}
          style={{ position: 'absolute', top: 20, left: 20, zIndex: 10 }}
        >
          Call Remote
        </button>
        <button
          onClick={toogleRecognition}
          style={{ position: 'absolute', top: 70, left: 20, zIndex: 10 }}
        >
          Transcrip
        </button>
        <button
          onClick={setRussian}
          style={{ position: 'absolute', top: 70, right: 125, zIndex: 10 }}
        >
          Русский
        </button>
        <button
          onClick={setSpanish}
          style={{ position: 'absolute', top: 70, right: 20, zIndex: 10 }}
        >
          Español
        </button>
      </dialog>
    </div>
  );
};

export default App;
