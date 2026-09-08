"""Rig the ImageGen/Rodin pedestrian and bake her walking and sitting poses."""
import bpy, math, json
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'design/granny/granny-rodin.glb'))
mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH');bpy.context.view_layer.objects.active=mesh
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
v=np.array([x.co[:] for x in mesh.data.vertices]);lo=v.min(axis=0);hi=v.max(axis=0);factor=2.65/(hi[2]-lo[2]);center=(lo+hi)*.5
for x in mesh.data.vertices:x.co=Vector(((x.co.x-center[0])*factor,(x.co.y-center[1])*factor,(x.co.z-lo[2])*factor))
mesh.name='Rodin Pixel Granny';mesh.data.update()
for m in mesh.data.materials:
 for node in m.node_tree.nodes:
  if node.type=='TEX_IMAGE' and node.image and max(node.image.size)>1024:node.image.scale(1024,1024)
arm=bpy.data.objects.new('GrannyRig',bpy.data.armatures.new('GrannyRig'));bpy.context.collection.objects.link(arm);bpy.context.view_layer.objects.active=arm;mesh.select_set(False);arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
spec={'Hips':((0,0,.82),(0,0,1.06),None),'Spine':((0,0,1.06),(0,0,1.44),'Hips'),'Head':((0,0,1.44),(0,0,2.6),'Spine')}
for side,s in [('L',1),('R',-1)]:
 spec.update({side+'Arm':((s*.32,0,1.43),(s*.69,0,1.43),'Spine'),side+'ForeArm':((s*.69,0,1.43),(s*1.03,0,1.43),side+'Arm'),side+'Hand':((s*1.03,0,1.43),(s*1.27,0,1.43),side+'ForeArm'),side+'Thigh':((s*.23,0,.82),(s*.24,0,.47),'Hips'),side+'Shin':((s*.24,0,.47),(s*.25,0,.13),side+'Thigh'),side+'Foot':((s*.25,0,.13),(s*.25,-.21,.1),side+'Shin')})
for name,(head,tail,parent) in spec.items():
 b=arm.data.edit_bones.new(name);b.head=head;b.tail=tail
 if parent:b.parent=arm.data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');coords=np.array([v.co[:] for v in mesh.data.vertices]);names=list(spec);dist=[]
for name in names:
 a,b,_=spec[name];a=np.array(a);b=np.array(b);d=b-a;t=np.clip(((coords-a)*d).sum(axis=1)/(d*d).sum(),0,1);dist.append(np.linalg.norm(coords-a-t[:,None]*d,axis=1))
dist=np.array(dist).T
for i,p in enumerate(coords):
 side='L' if p[0]>=0 else 'R'
 allow=([side+'Thigh',side+'Shin',side+'Foot','Hips'] if p[2]<.83 else [side+'Arm',side+'ForeArm',side+'Hand','Spine'] if abs(p[0])>.43 and 1.15<p[2]<1.65 else ['Head'] if p[2]>1.62 else ['Hips','Spine','Head'])
 for j,n in enumerate(names):
  if n not in allow:dist[i,j]=1e4
for n in names:mesh.vertex_groups.new(name=n)
for i,inds in enumerate(np.argsort(dist,axis=1)[:,:2]):
 w=np.exp(-np.square(dist[i,inds])*58);w/=max(w.sum(),1e-20)
 for j,weight in zip(inds,w):
  if weight>.015:mesh.vertex_groups[names[j]].add([i],float(weight),'REPLACE')
mod=mesh.modifiers.new('Granny skin','ARMATURE');mod.object=arm;mesh.parent=arm;targets={}
for side,s in [('L',1),('R',-1)]:
 for limb,bone in [('Hand',side+'ForeArm'),('Foot',side+'Shin')]:
  obj=bpy.data.objects.new(side+limb+'Target',None);bpy.context.collection.objects.link(obj);targets[side+limb]=obj
  c=arm.pose.bones[bone].constraints.new('IK');c.target=obj;c.chain_count=2;c.use_stretch=False
  pole=bpy.data.objects.new(side+limb+'Pole',None);bpy.context.collection.objects.link(pole);pole.location=(s*2,1,.9) if limb=='Hand' else (s*.25,-3,1)
  c.pole_target=pole;c.pole_angle=0 if limb=='Foot' else -math.pi/2*s
  if limb=='Foot':
   obj.rotation_mode='QUATERNION';obj.rotation_quaternion=arm.data.bones[side+'Foot'].matrix_local.to_quaternion();c=arm.pose.bones[side+'Foot'].constraints.new('COPY_ROTATION');c.target=obj;c.owner_space='WORLD';c.target_space='WORLD'
scene=bpy.context.scene;scene.render.fps=30;actions=[]
for name,frames in [('Idle',31),('Walk',25),('Sit',16)]:
 arm.animation_data_clear()
 for obj in targets.values():obj.animation_data_clear()
 for frame in range(1,frames+1):
  u=(frame-1)/(frames-1);a=u*math.tau
  for pb in arm.pose.bones:pb.location=(0,0,0);pb.rotation_mode='XYZ';pb.rotation_euler=(0,0,0)
  seated=u*u*(3-2*u) if name=='Sit' else 0
  arm.pose.bones['Hips'].location.y=-.64*seated+(.035*math.sin(a*2) if name=='Walk' else 0)
  arm.pose.bones['Spine'].rotation_euler.x=.08+.11*seated
  arm.pose.bones['Head'].rotation_euler.x=-.04-.04*seated
  for side,s in [('L',1),('R',-1)]:
   phase=a+(0 if s==1 else math.pi)
   targets[side+'Foot'].location=(s*.25,-.57*seated+(-.28*math.cos(phase) if name=='Walk' else 0),.13+(max(0,math.sin(phase))*.14 if name=='Walk' else 0))
   targets[side+'Hand'].location=(s*(.47-.18*seated),-.09-.34*seated+(.15*math.cos(phase) if name=='Walk' else 0),.91-.50*seated)
  for pb in arm.pose.bones:pb.keyframe_insert('location',frame=frame);pb.keyframe_insert('rotation_euler',frame=frame)
  for obj in targets.values():obj.keyframe_insert('location',frame=frame)
 matrices=[]
 for frame in range(1,frames+1):
  scene.frame_set(frame);bpy.context.view_layer.update();matrices.append({pb.name:pb.matrix.copy() for pb in arm.pose.bones})
 for pb in arm.pose.bones:
  for con in pb.constraints:con.mute=True
 arm.animation_data_clear();act=bpy.data.actions.new(name);arm.animation_data_create();arm.animation_data.action=act
 for frame,mats in enumerate(matrices,1):
  for pb in arm.pose.bones:
   kwargs={'parent_matrix':mats[pb.parent.name],'parent_matrix_local':pb.parent.bone.matrix_local} if pb.parent else {}
   pb.matrix_basis=pb.bone.convert_local_to_pose(mats[pb.name],pb.bone.matrix_local,invert=True,**kwargs)
   pb.keyframe_insert('location',frame=frame);pb.keyframe_insert('rotation_euler',frame=frame);pb.keyframe_insert('scale',frame=frame)
 act.use_fake_user=True;actions.append(act)
 for pb in arm.pose.bones:
  for con in pb.constraints:con.mute=False
for pb in arm.pose.bones:
 for con in list(pb.constraints):pb.constraints.remove(con)
arm.animation_data_clear();arm.animation_data_create();arm.animation_data.action=actions[0]
for act in list(bpy.data.actions):
 if act not in actions:bpy.data.actions.remove(act)
scene.frame_set(1);bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);arm.select_set(True)
output=ROOT/'public/assets/granny';output.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'design/granny/granny-rig.blend'))
bpy.ops.export_scene.gltf(filepath=str(output/'granny.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_def_bones=True)
print('GRANNY_EXPORT',json.dumps({'bytes':(output/'granny.glb').stat().st_size,'vertices':len(mesh.data.vertices),'actions':[a.name for a in actions]}))
