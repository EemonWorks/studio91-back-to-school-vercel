import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { pencilPose } from './shared';

export function CatMarker({ yours, side }: { yours: boolean; side: number }) {
  const fur = yours ? '#eeaa58' : '#9695b8';
  return <group position={[side * 0.36, 1.17, 0.15]} rotation={[0, 0.45, 0]} name={yours ? 'your-seat-cat' : 'classmate-seat-cat'}>
    <mesh position={[0, 0.21, 0]} scale={[0.17, 0.25, 0.14]}><sphereGeometry args={[1, 16, 12]} /><meshStandardMaterial color={fur} /></mesh>
    <mesh position={[0, 0.46, 0.01]} scale={[1, 0.88, 0.9]}><sphereGeometry args={[0.185, 16, 12]} /><meshStandardMaterial color={fur} /></mesh>
    {[-0.115, 0.115].map((x) => <mesh key={x} position={[x, 0.61, 0.008]} rotation={[0, 0, x < 0 ? 0.25 : -0.25]}>
      <coneGeometry args={[0.085, 0.18, 3]} /><meshStandardMaterial color={fur} />
    </mesh>)}
    {[-0.067, 0.067].map((x) => <mesh key={x} position={[x, 0.48, 0.16]}>
      <sphereGeometry args={[0.023, 8, 8]} /><meshStandardMaterial color="#242439" />
    </mesh>)}
    <mesh position={[0, 0.415, 0.174]}><sphereGeometry args={[0.022, 8, 8]} /><meshStandardMaterial color="#e78b9d" /></mesh>
    <mesh position={[0, 0.055, 0.09]} scale={[0.2, 0.06, 0.14]}><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color={fur} /></mesh>
    <mesh position={[0.16, 0.13, -0.04]} rotation={[1.3, 0.2, 0.2]}>
      <torusGeometry args={[0.19, 0.045, 8, 18, Math.PI * 1.5]} /><meshStandardMaterial color={fur} />
    </mesh>
    <mesh position={[0, 0.325, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.125, 0.025, 6, 18]} /><meshStandardMaterial color={yours ? '#cce94a' : '#f6bcdb'} />
    </mesh>
  </group>;
}

export function PencilMound({ count }: { count: number }) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const { invalidate } = useThree();
  const parts = useMemo(() => [
    { geometry: new THREE.CylinderGeometry(0.03, 0.03, 1.04, 6), material: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.65 }), offset: 0 },
    { geometry: new THREE.ConeGeometry(0.035, 0.18, 6), material: new THREE.MeshStandardMaterial({ color: '#e4bc88' }), offset: 0.61 },
    { geometry: new THREE.ConeGeometry(0.014, 0.07, 6), material: new THREE.MeshStandardMaterial({ color: '#323547' }), offset: 0.715 },
    { geometry: new THREE.CylinderGeometry(0.034, 0.034, 0.08, 8), material: new THREE.MeshStandardMaterial({ color: '#c1c4d2', metalness: 0.4, roughness: 0.4 }), offset: -0.56 },
    { geometry: new THREE.CylinderGeometry(0.032, 0.032, 0.12, 8), material: new THREE.MeshStandardMaterial({ color: '#f48bb3' }), offset: -0.66 },
  ], []);
  useEffect(() => () => {
    for (const part of parts) { part.geometry.dispose(); part.material.dispose(); }
  }, [parts]);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const palette = ['#ffd34e', '#e75d9a', '#48a9e3', '#b5d743', '#9c78dd'];
    const color = new THREE.Color();
    for (let index = 0; index < count; index++) {
      const pose = pencilPose(index, count);
      parts.forEach((part, partIndex) => {
        const mesh = meshes.current[partIndex];
        if (!mesh) return;
        dummy.position.set(pose.x, pose.y, pose.z);
        dummy.rotation.set(0, pose.angle, -Math.PI / 2);
        dummy.translateY(part.offset);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        if (partIndex === 0) mesh.setColorAt(index, color.set(palette[index % palette.length]!));
      });
    }
    for (const mesh of meshes.current) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    invalidate();
  }, [count, parts, invalidate]);
  return <group name={`pencil-mound-${count}`} userData={{ pencilCount: count }}>
    {parts.map((part, index) => <instancedMesh key={index}
      ref={(mesh) => { meshes.current[index] = mesh; }}
      args={[part.geometry, part.material, count]} frustumCulled={false} />)}
  </group>;
}

export function graffitiDrawing(seed: number) {
  return (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, 1024, 512);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#532b615c';
    ctx.lineWidth = 3;
    for (let i = 0; i < 22; i++) {
      const x = 25 + ((i * 193 + seed * 31) % 950);
      const y = 18 + ((i * 83 + seed * 47) % 460);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16 + (i % 4) * 9, y - 10); ctx.stroke();
    }
    ctx.save(); ctx.translate(140, 180); ctx.rotate(-0.15);
    ctx.strokeStyle = '#59365bb3'; ctx.lineWidth = 4;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * 42, -38); ctx.lineTo(i * 42, 87); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 42 - 38); ctx.lineTo(126, i * 42 - 38); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(20, -17, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(51, 10); ctx.lineTo(76, 35); ctx.moveTo(76, 10); ctx.lineTo(51, 35); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#533960bc';
    ctx.font = '700 43px "Outfit Variable", Arial, sans-serif';
    ctx.save(); ctx.translate(610, 120 + seed % 3 * 20); ctx.rotate(0.1);
    ctx.fillText(seed % 2 ? '91 WAS HERE' : 'zzz... last period', 0, 0); ctx.restore();
    ctx.strokeStyle = '#465780b0'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(740, 330); ctx.bezierCurveTo(670, 270, 650, 380, 740, 420);
    ctx.bezierCurveTo(830, 380, 810, 270, 740, 330); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(390, 350); ctx.lineTo(430, 290); ctx.lineTo(470, 350);
    ctx.lineTo(415, 330); ctx.lineTo(445, 385); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = '#582c5a50'; ctx.lineWidth = 6;
    ctx.strokeRect(7, 7, 1010, 498);
  };
}
