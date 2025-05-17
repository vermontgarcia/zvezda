/* eslint-disable @typescript-eslint/no-explicit-any */
import './App.css';
import { useEffect, useRef, useState } from 'react';
import { WS_SERVER_URL, API_SERVER_URL } from './utils/const.env';

const signalingWSServerUrl = `${WS_SERVER_URL}`; // Change if needed
const signalingAPIServerUrl = `${API_SERVER_URL}`; // Change if needed

const App = () => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const remoteDataChannelRef = useRef<RTCDataChannel | null>(null);
  const recognitionRef = useRef<any | null>(null);
  const startedRef = useRef<boolean>(false);

  type Transcript = {
    id: string;
    type: string;
    text: string;
    origin: string;
    translation?: string;
    date: number;
  };

  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [interim, setInterim] = useState<string>('');
  const [videoSource, setVideoSource] = useState<boolean>(true);
  const [started, setStarted] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(true);
  const [openIncoming, setOpenIncoming] = useState<boolean>(false);
  const [isInCall, setIsInCall] = useState<boolean>(false);
  const [callerId, setCallerId] = useState<string>('');

  const startLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localStreamRef.current = stream;
      }
    } catch (error) {
      console.error('Could not access media devices.', error);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${signalingAPIServerUrl}/ping`, {
        method: 'GET',
      });
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    ws.current = new WebSocket(signalingWSServerUrl);

    ws.current.onopen = () => {
      console.log('Connected to signaling server');
      const userAgent = navigator.userAgent;
      const browserInfo = {
        appName: navigator.appName,
        appVersion: navigator.appVersion,
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: navigator.languages,
      };
      const screenInfo = {
        width: window.screen.width,
        height: window.screen.height,
        devicePixelRatio: window.devicePixelRatio,
        orientation: window.screen.orientation?.type || 'unknown',
      };
      const isTouchDevice =
        'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const diagnostics = {
        userAgent,
        browserInfo,
        screenInfo,
        isTouchDevice,
        timestamp: new Date().toISOString(),
      };
      ws.current?.send(
        JSON.stringify({
          type: 'diagnostics',
          diagnostics,
        })
      );
    };

    ws.current.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.current.onmessage = async (message) => {
      const data = JSON.parse(message.data);

      switch (data.type) {
        case 'call-request':
          showIncomingCallModal(data.from);
          break;
        case 'call-accepted':
          await createPeerConnection();
          await callRemotePeer();
          setIsInCall(true);
          break;
        case 'call-rejected':
          alert('Call rejected');
          break;
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
        case 'hang-up':
          hangUp(false);
          break;
        case 'translation':
          addTranslation(data);
          break;
        default:
          console.warn('Unknown message type:', data);
      }
    };

    return () => {
      ws.current?.close();
    };
  }, []);

  useEffect(() => {
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

    recognitionRef.current.onstart = () => {
      ws.current?.send(
        JSON.stringify({
          type: 'regognitionStatus',
          event: 'Recognition started',
          timestamp: new Date().toISOString(),
        })
      );
    };
    recognitionRef.current.onspeechstart = () => {
      ws.current?.send(
        JSON.stringify({
          type: 'regognitionStatus',
          event: 'Speech detected',
          timestamp: new Date().toISOString(),
        })
      );
    };
    recognitionRef.current.onspeechend = () => {
      ws.current?.send(
        JSON.stringify({
          type: 'regognitionStatus',
          event: 'Speech ended',
          timestamp: new Date().toISOString(),
        })
      );
    };

    recognitionRef.current.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i];
        if (result.isFinal) finalTranscript += result[0].transcript;
        else interimTranscript += result[0].transcript;
      }

      if (finalTranscript) {
        const transcriptionId = crypto.randomUUID();
        const date = Date.now();
        const localTranscrip = {
          id: transcriptionId,
          date,
          type: 'transcript',
          text: finalTranscript,
          origin: 'local',
          currentLanguage: recognitionRef.current.lang,
        };
        const remoteTranscript = {
          id: transcriptionId,
          date,
          type: 'transcript',
          text: finalTranscript,
          origin: 'remote',
          currentLanguage: recognitionRef.current.lang,
        };
        ws.current?.send(
          JSON.stringify({
            type: 'translationRequest',
            transcript: localTranscrip,
            sourceLanguage: recognitionRef.current.lang,
          })
        );
        setTranscripts((prev) => [...prev, localTranscrip]);
        setInterim('');
        if (remoteDataChannelRef.current?.readyState === 'open') {
          remoteDataChannelRef.current?.send(JSON.stringify(remoteTranscript));
        } else {
          dataChannelRef.current?.send(JSON.stringify(remoteTranscript));
        }
        ws.current?.send(
          JSON.stringify({
            type: 'regognitionStatus',
            event: 'Final Transcript',
            finalTranscript,
            timestamp: new Date().toISOString(),
          })
        );
      } else {
        setInterim(interimTranscript.trim());
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
        ws.current?.send(
          JSON.stringify({
            type: 'regognitionStatus',
            event: 'Interim Transcript',
            interimTranscript,
            timestamp: new Date().toISOString(),
          })
        );
      }
    };

    recognitionRef.current.onerror = (event: any) => {
      if (event.error !== 'no-speech')
        console.error('Speech recognition error:', event);
      ws.current?.send(
        JSON.stringify({
          type: 'regognitionStatus',
          event: 'Recognition error',
          error: event.error,
          timestamp: new Date().toISOString(),
        })
      );
    };

    recognitionRef.current.onend = () => {
      if (startedRef.current) {
        console.log('Recognition Stopped. Recognition enabled. Restarting...');
        setTimeout(() => recognitionRef.current.start(), 2500);
      } else {
        console.log(
          'Recognition Stopped. Recognition disabled. Not restarting!'
        );
      }
      ws.current?.send(
        JSON.stringify({
          type: 'regognitionStatus',
          event: 'Recognition ended',
          timestamp: new Date().toISOString(),
        })
      );
    };

    return () => {
      recognitionRef.current.stop();
      recognitionRef.current.onend = null;
    };
  }, []);

  // useEffect(() => {
  //   const userAgent = navigator.userAgent;
  //   const browserInfo = {
  //     appName: navigator.appName,
  //     appVersion: navigator.appVersion,
  //     platform: navigator.platform,
  //     userAgent: navigator.userAgent,
  //     language: navigator.language,
  //     languages: navigator.languages,
  //   };
  //   const screenInfo = {
  //     width: window.screen.width,
  //     height: window.screen.height,
  //     devicePixelRatio: window.devicePixelRatio,
  //     orientation: window.screen.orientation?.type || 'unknown',
  //   };
  //   const isTouchDevice =
  //     'ontouchstart' in window || navigator.maxTouchPoints > 0;
  //   const diagnostics = {
  //     userAgent,
  //     browserInfo,
  //     screenInfo,
  //     isTouchDevice,
  //     timestamp: new Date().toISOString(),
  //   };
  //   ws.current?.send(
  //     JSON.stringify({
  //       type: 'diagnostics',
  //       diagnostics,
  //     })
  //   );
  // }, []);

  const addTranslation = (data: any) => {
    console.log(data);
    setTranscripts((prev) => {
      const newTranscript = prev.map((message) => {
        if (message.id === data.transcriptionId) {
          return {
            ...message,
            translation: data.translation,
          };
        } else {
          return message;
        }
      });
      return [...newTranscript];
    });
  };

  const callUser = (targetUserId = 'targetUserId') => {
    ws.current?.send(
      JSON.stringify({
        type: 'call-request',
        from: '', //'currentUserId',
        to: targetUserId,
      })
    );
    setOpen(false);
  };

  const hangUp = (notify = true) => {
    // Stop Video tracks
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    // Close peer connection
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    // Clear data channels
    dataChannelRef.current = null;
    remoteDataChannelRef.current = null;
    // Notify remote
    if (notify) {
      ws.current?.send(JSON.stringify({ type: 'hang-up' }));
    }
    setIsInCall(false);
    setOpen(true);
    stopRecognition();
    // setTranscripts([]);
  };

  const showIncomingCallModal = (callerId: string = '') => {
    setCallerId(callerId);
    setOpenIncoming(true);
    setOpen(false);
  };

  const acceptCall = async () => {
    await createPeerConnection();
    ws.current?.send(JSON.stringify({ type: 'call-accepted', to: 'callerId' }));
    setOpenIncoming(false);
    setIsInCall(true);
  };

  const rejectCall = () => {
    ws.current?.send(JSON.stringify({ type: 'call-rejected', to: 'callerId' }));
    setOpenIncoming(false);
  };

  const createPeerConnection = async () => {
    await startLocalStream();

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    const dc = pc.createDataChannel('transcription');

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    dc.onopen = () => {
      console.log('DataChannel is open');
    };

    dc.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('[Received on master]', data);
      if (data.type === 'transcript') {
        setTranscripts((prev) => [...prev, data]);
      }
    };
    dataChannelRef.current = dc;

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
    let dc: RTCDataChannel | null = null;
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

    pc.ondatachannel = (event) => {
      dc = event.channel;
      dc.onopen = () => {
        console.log('DataChannel is open');
      };

      dc.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('[Received on remote]', data);
        if (data.type === 'transcript') {
          setTranscripts((prev) => [...prev, data]);
        }
      };

      remoteDataChannelRef.current = dc;
    };
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
    if (!openIncoming) {
      setOpen(true);
      setTimeout(() => {
        setOpen(false);
      }, 5000);
    }
  };

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
        ref={localVideoRef}
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
          className="transcription-container"
          style={{
            position: 'absolute',
            right: '1rem',
            bottom: '1rem',
            padding: '0 1rem',
            maxHeight: '30%',
            width: '50%',
            overflowY: 'auto',
            backgroundColor: 'transparent',
            textAlign: 'end',
            maxWidth: '50%',
            color: 'yellow',
            fontSize: '1rem',
            zIndex: 1,
            WebkitMaskImage:
              'linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,1), rgba(0,0,0,0))',
            maskImage:
              'linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,1), rgba(0,0,0,0))',
            textShadow: '2px 2px 2px black',
          }}
        >
          {transcripts.map((line) => (
            <div className={`${line.origin}-translation-row`} key={line.id}>
              <p className={line.origin} style={{ margin: '0' }}>
                {line.text}
              </p>
              <p
                className={`${line.origin}-translation`}
                style={{ margin: '0' }}
              >
                {line.translation}
              </p>
            </div>
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
        {!isInCall && (
          <button
            onClick={() => callUser()}
            style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 10 }}
          >
            Call
          </button>
        )}
        <button
          onClick={toogleRecognition}
          style={{ position: 'absolute', top: 20, left: 20, zIndex: 10 }}
        >
          Transcrip
        </button>
        <button
          onClick={setRussian}
          style={{ position: 'absolute', top: 70, left: 20, zIndex: 10 }}
        >
          Русский
        </button>
        <button
          onClick={setSpanish}
          style={{ position: 'absolute', top: 70, left: 130, zIndex: 10 }}
        >
          Español
        </button>
        {isInCall && (
          <button
            onClick={() => hangUp(true)}
            style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 10 }}
          >
            End Call
          </button>
        )}
      </dialog>
      <dialog
        open={openIncoming}
        style={{
          border: '1px solid red',
          width: '90%',
          height: '94.5%',
          zIndex: 20,
          backgroundColor: 'transparent',
        }}
      >
        <div>{callerId} Incomming call... </div>
        <button
          onClick={acceptCall}
          style={{ position: 'absolute', top: 70, left: 20, zIndex: 10 }}
        >
          Accept
        </button>
        <button
          onClick={rejectCall}
          style={{ position: 'absolute', top: 70, right: 20, zIndex: 10 }}
        >
          Reject
        </button>
      </dialog>
    </div>
  );
};

export default App;
