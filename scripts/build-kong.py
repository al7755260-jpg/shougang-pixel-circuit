"""Rebind the Rodin gorilla and bake stable, non-stretching game animation.
Run only in a separate Blender --background process. No live scene is modified.
The existing hand trajectory remains the shared solo/network contact contract.
"""
import bpy, math, json
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'design/kong/kong-rodin.glb'))
mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH')
bpy.context.view_layer.objects.active=mesh;mesh.select_set(True)
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
coords=np.array([v.co[:] for v in mesh.data.vertices]);low=coords.min(axis=0);high=coords.max(axis=0)
factor=8.6/(high[2]-low[2]);center=(low+high)*.5
for v in mesh.data.vertices:v.co=Vector(((v.co.x-center[0])*factor,(v.co.y-center[1])*factor,(v.co.z-low[2])*factor))
mesh.name='Rodin Voxel Silverback';mesh.data.update()
for mat in mesh.data.materials:
 if not mat or not mat.use_nodes:continue
 for node in mat.node_tree.nodes:
  if node.type=='TEX_IMAGE' and node.image and max(node.image.size)>1024:node.image.scale(1024,1024)
  if node.type=='BSDF_PRINCIPLED':
   node.inputs['Roughness'].default_value=.86
   node.inputs['Metallic'].default_value=.05
arm_data=bpy.data.armatures.new('Kong anatomical rig')
arm=bpy.data.objects.new('KongRig',arm_data);bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active=arm;mesh.select_set(False);arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
spec={
 'Hips':((0,0,3.4),(0,0,4.25),None),
 'Spine':((0,0,4.25),(0,0,5.45),'Hips'),
 'Chest':((0,0,5.45),(0,0,6.25),'Spine'),
 'Head':((0,-.13,6.25),(0,-.13,8.4),'Chest')}
for side,s in [('L',1),('R',-1)]:
 spec.update({
  side+'Shoulder':((s*.35,0,6.0),(s*1.55,0,5.93),'Chest'),
  side+'Arm':((s*1.55,0,5.93),(s*2.88,0,5.78),side+'Shoulder'),
  side+'ForeArm':((s*2.88,0,5.78),(s*4.21,0,5.66),side+'Arm'),
  side+'Hand':((s*4.21,0,5.66),(s*5.13,0,5.66),side+'ForeArm'),
  side+'Thigh':((s*.85,0,3.4),(s*1.06,-.13,1.88),'Hips'),
  side+'Shin':((s*1.06,-.13,1.88),(s*1.12,0,.42),side+'Thigh'),
  side+'Foot':((s*1.12,0,.42),(s*1.12,-.75,.22),side+'Shin')})
for name,(head,tail,parent) in spec.items():
 b=arm_data.edit_bones.new(name);b.head=head;b.tail=tail
 if parent:b.parent=arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')

def smooth(a,b,v):
 t=max(0,min(1,(v-a)/(b-a)));return t*t*(3-2*t)
def blend(a,b,f):
 return {n:a.get(n,0)*(1-f)+b.get(n,0)*f for n in a.keys()|b.keys()}
# Keep blocky body regions coherent. Blend only across their actual joints;
# nearest-segment weights used to pull shoulder armour, wrists and knees apart.
for name in spec:mesh.vertex_groups.new(name=name)
for v in mesh.data.vertices:
 x=abs(v.co.x);z=v.co.z;side='L' if v.co.x>=0 else 'R'
 if z<3.65:
  w=blend({side+'Foot':1},{side+'Shin':1},smooth(.48,.86,z))
  w=blend(w,{side+'Thigh':1},smooth(1.68,2.12,z))
  w=blend(w,{'Hips':1},smooth(3.05,3.65,z))
 else:
  w=blend({'Hips':1},{'Spine':1},smooth(3.65,4.3,z))
  w=blend(w,{'Chest':1},smooth(4.8,5.3,z))
  w=blend(w,{'Head':1},smooth(6.3,6.85,z)*(1-smooth(1.05,1.65,x)))
  limb=blend({side+'Arm':1},{side+'ForeArm':1},smooth(2.67,3.08,x))
  limb=blend(limb,{side+'Hand':1},smooth(4.02,4.27,x))
  w=blend(w,limb,smooth(1.32,2.02,x)*smooth(4.25,4.9,z))
 weights=sorted(((n,value) for n,value in w.items() if value>.001),key=lambda p:-p[1])[:4]
 total=sum(value for n,value in weights)
 for n,value in weights:mesh.vertex_groups[n].add([v.index],value/total,'REPLACE')
mod=mesh.modifiers.new('Kong skin','ARMATURE');mod.object=arm;mesh.parent=arm
mod.use_deform_preserve_volume=False # Match the linear skinning used by glTF/Three.js.

hand_text=(ROOT/'src/kong-hand-samples.js').read_text(encoding='utf8')
HAND=json.loads(hand_text.split('export const KONG_HAND=')[1].split(';')[0])
def hand_path(u):
 for a,b in zip(HAND,HAND[1:]):
  if u<=b[0]+1e-6:
   f=max(0,min(1,(u-a[0])/(b[0]-a[0])))
   return Vector((a[1]+(b[1]-a[1])*f,-(a[3]+(b[3]-a[3])*f),a[2]+(b[2]-a[2])*f+.4))
 return Vector((HAND[-1][1],-HAND[-1][3],HAND[-1][2]+.4))
def quat(axis,angle):return Quaternion(Vector(axis),angle)
IDENTITY=Quaternion((1,0,0,0))
rest={b.name:b.matrix_local.copy() for b in arm_data.bones}
def rigid(name,head,direction):
 # Shortest-arc swing from the real rest bone, without IK pole-angle roll.
 # No axial stretch, and no arbitrary mirrored elbow/wrist twist.
 bone=arm_data.bones[name]
 delta=(bone.tail_local-bone.head_local).rotation_difference(direction)
 return Matrix.LocRotScale(head,delta@rest[name].to_quaternion(),Vector((1,1,1)))
def chain(root,target,pole,l1,l2):
 axis=target-root;distance=axis.length
 direction=axis.normalized()
 distance=max(abs(l1-l2)+.002,min(l1+l2-.002,distance))
 endpoint=root+direction*distance
 perpendicular=pole-root-direction*(pole-root).dot(direction)
 if perpendicular.length<1e-5:raise ValueError('Unstable limb bend plane')
 perpendicular.normalize()
 along=(l1*l1-l2*l2+distance*distance)/(2*distance)
 elbow=root+direction*along+perpendicular*math.sqrt(max(0,l1*l1-along*along))
 return elbow,endpoint
def local_pose(name,mats,rotation=IDENTITY,translation=Vector((0,0,0))):
 bone=arm_data.bones[name];parent=bone.parent
 local=rest[parent.name].inverted()@rest[name] if parent else rest[name]
 mats[name]=(mats[parent.name] if parent else Matrix.Identity(4))@local@Matrix.LocRotScale(translation,rotation,Vector((1,1,1)))
def idle_targets(phase):
 hands={s:Vector((sign*2.0,-.35,3.5+.055*math.sin(phase))) for s,sign in [('L',1),('R',-1)]}
 feet={s:Vector((sign*1.1,0,.42)) for s,sign in [('L',1),('R',-1)]}
 return hands,feet

scene=bpy.context.scene;scene.render.fps=30
actions=[];max_contact_error=0
for action_name,frames in [('Idle',31),('Run',31),('Grab',36),('Throw',20)]:
 arm.animation_data_clear();arm.animation_data_create()
 act=bpy.data.actions.new(action_name);arm.animation_data.action=act
 previous_quats={}
 for frame in range(1,frames+1):
  u=(frame-1)/(frames-1);phase=u*math.tau
  hands,feet=idle_targets(phase);drop=0;bend=.075;roll=0
  if action_name=='Run':
   drop=-.27+.06*math.cos(phase*2);bend=.14;roll=.028*math.sin(phase)
   for side,s in [('L',1),('R',-1)]:
    cycle=phase+(0 if s==1 else math.pi)
    feet[side]=Vector((s*1.07,math.cos(cycle)*1.05,.42+max(0,math.sin(cycle))*.65))
    hands[side]=Vector((s*2.03,-math.cos(cycle)*.75-.45,3.5+.15*math.sin(cycle)))
  elif action_name=='Grab':
   drop=-2.0*(1-u)**1.25;bend=.35*(1-u)+.06*u
   contact=hand_path(u)
   for side,s in [('L',1),('R',-1)]:
    hands[side]=contact+Vector((s*1.12,0,0))
    feet[side]=Vector((s*1.1,-.15,.42))
  elif action_name=='Throw':
   # Frame one equals the held high pose. Release, follow through, then stand.
   contact=hand_path(1);throw=smooth(0,.46,u);settle=smooth(.45,1,u)
   drop=-.13*math.sin(u*math.pi);bend=.06+.22*math.sin(u*math.pi)
   for side,s in [('L',1),('R',-1)]:
    thrown=Vector((s*(1.12+.8*throw),contact.y-1.1*math.sin(throw*math.pi),contact.z-4.25*throw))
    hands[side]=thrown.lerp(Vector((s*2.0,-.35,3.5)),settle)
    feet[side]=Vector((s*1.1,-.15*(1-settle),.42))
  mats={}
  local_pose('Hips',mats,translation=Vector((0,drop,0)))
  local_pose('Spine',mats,quat((1,0,0),bend)@quat((0,0,1),roll))
  local_pose('Chest',mats)
  local_pose('Head',mats,quat((1,0,0),-bend*.8))
  for side,s in [('L',1),('R',-1)]:
   local_pose(side+'Shoulder',mats)
   shoulder=mats[side+'Shoulder']@Vector((0,arm_data.bones[side+'Shoulder'].length,0))
   # Elbows stay outside the rib cage, and bend in one stable anatomical plane.
   elbow,wrist=chain(shoulder,hands[side],shoulder+Vector((s*4,.35,-.5)),
                    arm_data.bones[side+'Arm'].length,arm_data.bones[side+'ForeArm'].length)
   mats[side+'Arm']=rigid(side+'Arm',shoulder,elbow-shoulder)
   mats[side+'ForeArm']=rigid(side+'ForeArm',elbow,wrist-elbow)
   hold=smooth(0,.16,u) if action_name=='Grab' else 1-smooth(.35,1,u) if action_name=='Throw' else 0
   # Palms face each other during the lift, rather than rotating with elbow roll.
   relaxed=Vector((s*.12,-.12,-1))
   hand_direction=relaxed.lerp(Vector((s*.12,-1,-.08)),hold).normalized()
   mats[side+'Hand']=rigid(side+'Hand',wrist,hand_direction)
   hip=mats['Hips']@rest['Hips'].inverted()@arm_data.bones[side+'Thigh'].head_local
   knee,ankle=chain(hip,feet[side],hip+Vector((s*.18,-4,0)),
                   arm_data.bones[side+'Thigh'].length,arm_data.bones[side+'Shin'].length)
   mats[side+'Thigh']=rigid(side+'Thigh',hip,knee-hip)
   mats[side+'Shin']=rigid(side+'Shin',knee,ankle-knee)
   mats[side+'Foot']=Matrix.LocRotScale(ankle,rest[side+'Foot'].to_quaternion(),Vector((1,1,1)))
   if action_name=='Grab':max_contact_error=max(max_contact_error,(wrist-hands[side]).length)
  for pb in arm.pose.bones:
   kwargs={'parent_matrix':mats[pb.parent.name],'parent_matrix_local':pb.parent.bone.matrix_local} if pb.parent else {}
   basis=pb.bone.convert_local_to_pose(mats[pb.name],pb.bone.matrix_local,invert=True,**kwargs)
   location,rotation,scale=basis.decompose()
   if pb.name in previous_quats and rotation.dot(previous_quats[pb.name])<0:rotation.negate()
   previous_quats[pb.name]=rotation.copy()
   pb.rotation_mode='QUATERNION';pb.location=location;pb.rotation_quaternion=rotation;pb.scale=(1,1,1)
   pb.keyframe_insert('location',frame=frame);pb.keyframe_insert('rotation_quaternion',frame=frame)
  scene.frame_set(frame);bpy.context.view_layer.update()
 act.use_fake_user=True;actions.append(act)
 # Dense quaternion samples must not overshoot between baked poses.
 for layer in act.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     for key in fc.keyframe_points:key.interpolation='LINEAR'
arm.animation_data_clear();arm.animation_data_create()
for act in actions:
 tr=arm.animation_data.nla_tracks.new();tr.name=act.name
 tr.strips.new(act.name,1,act);tr.mute=True
arm.animation_data.action=actions[0];scene.frame_set(1)
out=ROOT/'public/assets/kong';out.mkdir(parents=True,exist_ok=True)
assert max_contact_error<.005, 'The hand rig no longer matches the network car trajectory'
bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);arm.select_set(True);bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'design/kong/kong-rig-fixed.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'kong.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_def_bones=True)
report={'bytes':(out/'kong.glb').stat().st_size,'vertices':len(mesh.data.vertices),'actions':[a.name for a in actions],'maxHandContractError':max_contact_error,'weights':'anatomical regions; normalized at joints','animation':'stable analytic limb planes, quaternion rotations, no bone scale tracks'}
(ROOT/'design/kong/rig-validation.json').write_text(json.dumps(report,indent=2))
print('KONG_EXPORT',json.dumps(report))
