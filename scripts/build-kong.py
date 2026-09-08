"""Bind the licensed Rodin mesh and bake a compact, contact-matched game rig.
Run with Blender --background --python scripts/build-kong.py.
Raw uploads remain under ignored design/kong; the game ships only the GLB.
"""
import bpy, math, json
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
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
  if node.type=='TEX_IMAGE' and node.image:
   im=node.image
   if max(im.size)>1024:im.scale(1024,1024)
  if node.type=='BSDF_PRINCIPLED':
   node.inputs['Roughness'].default_value=.86
   node.inputs['Metallic'].default_value=.05
arm_data=bpy.data.armatures.new('Kong contact rig');arm=bpy.data.objects.new('KongRig',arm_data);bpy.context.collection.objects.link(arm)
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
# Region-aware segment weights retain the stepped fur while allowing elbows/knees to bend.
verts=np.array([v.co[:] for v in mesh.data.vertices]);allnames=list(spec)
dist=[]
for name in allnames:
 a,b,_=spec[name];a=np.array(a);b=np.array(b);d=b-a
 t=np.clip(((verts-a)*d).sum(axis=1)/(d*d).sum(),0,1)
 dist.append(np.linalg.norm(verts-a-t[:,None]*d,axis=1))
dist=np.array(dist).T
for i,p in enumerate(verts):
 side='L' if p[0]>=0 else 'R';x=abs(p[0]);z=p[2]
 allowed=([side+'Thigh',side+'Shin',side+'Foot','Hips'] if z<3.5 else
          [side+'Shoulder',side+'Arm',side+'ForeArm',side+'Hand','Chest'] if x>1.55 and z>4.45 else
          ['Head','Chest'] if z>6.6 else ['Hips','Spine','Chest','Head'])
 for j,n in enumerate(allnames):
  if n not in allowed:dist[i,j]=1e4
for n in allnames:mesh.vertex_groups.new(name=n)
nearest=np.argsort(dist,axis=1)[:,:3]
for i,inds in enumerate(nearest):
 weights=np.exp(-np.square(dist[i,inds])*3.8);weights/=max(weights.sum(),1e-20)
 for j,w in zip(inds,weights):
  if w>.015:mesh.vertex_groups[allnames[j]].add([i],float(w),'REPLACE')
mod=mesh.modifiers.new('Kong skin','ARMATURE');mod.object=arm;mesh.parent=arm
targets={}
for side,s in [('L',1),('R',-1)]:
 for limb,bone in [('Hand',side+'ForeArm'),('Foot',side+'Shin')]:
  obj=bpy.data.objects.new(side+limb+'Target',None);bpy.context.collection.objects.link(obj);targets[side+limb]=obj
  con=arm.pose.bones[bone].constraints.new('IK');con.target=obj;con.chain_count=2;con.use_stretch=False
  pole=bpy.data.objects.new(side+limb+'Pole',None);bpy.context.collection.objects.link(pole)
  pole.location=(s*4,2,4.2) if limb=='Hand' else (s*1,-5,2)
  con.pole_target=pole;con.pole_angle=0 if limb=='Foot' else -math.pi/2*s
  if limb=='Foot':
   obj.rotation_mode='QUATERNION';obj.rotation_quaternion=arm.data.bones[side+'Foot'].matrix_local.to_quaternion()
   lock=arm.pose.bones[side+'Foot'].constraints.new('COPY_ROTATION');lock.target=obj;lock.owner_space='WORLD';lock.target_space='WORLD'

HAND=[[0,0,1.25,2.3],[.25,0,3.2,2.8],[.6,0,6,2.2],[1,0,7.7,1.7]]
def path(u):
 for a,b in zip(HAND,HAND[1:]):
  if u<=b[0]:
   f=(u-a[0])/(b[0]-a[0]);return [a[j]+(b[j]-a[j])*f for j in (1,2,3)]
 return HAND[-1][1:]
scene=bpy.context.scene;scene.render.fps=30
actions=[];contacts=[]
for action_name,frames in [('Idle',31),('Run',28),('Grab',36),('Throw',20)]:
 arm.animation_data_clear()
 for obj in targets.values():obj.animation_data_clear()
 for frame in range(1,frames+1):
  u=(frame-1)/(frames-1);a=u*math.tau
  for pb in arm.pose.bones:pb.location=(0,0,0);pb.rotation_mode='XYZ';pb.rotation_euler=(0,0,0)
  hips=arm.pose.bones['Hips'];spine=arm.pose.bones['Spine'];head=arm.pose.bones['Head']
  if action_name=='Run':
   hips.location.y=.09+.12*math.cos(a*2);spine.rotation_euler.x=.22;head.rotation_euler.x=-.12
   for side,s in [('L',1),('R',-1)]:
    cycle=a+(0 if s==1 else math.pi)
    targets[side+'Foot'].location=(s*1.03,-math.cos(cycle)*1.65,.42+max(0,math.sin(cycle))*.85)
    targets[side+'Hand'].location=(s*1.8,math.cos(cycle)*1.15-.55,3.6+max(0,-math.sin(cycle))*.55)
  elif action_name in ['Grab','Throw']:
   if action_name=='Grab':
    x,y,z=path(u);hips.location.y=-2.15*(1-u)**1.45;spine.rotation_euler.x=.2*(1-u)
    for side,s in [('L',1),('R',-1)]:targets[side+'Hand'].location=(s*1.05,-z,y+.4)
   else:
    f=min(1,u*2.2);hips.location.y=-.18*math.sin(u*math.pi);spine.rotation_euler.x=.38*math.sin(u*math.pi)
    for side,s in [('L',1),('R',-1)]:targets[side+'Hand'].location=(s*(1.05+.8*f),-1.7-1.3*math.sin(f*math.pi),8.1-4.5*f)
   for side,s in [('L',1),('R',-1)]:targets[side+'Foot'].location=(s*1.15,-.15,.42)
  else:
   spine.rotation_euler.x=.1+.025*math.sin(a);head.rotation_euler.z=.06*math.sin(a)
   for side,s in [('L',1),('R',-1)]:
    targets[side+'Foot'].location=(s*1.1,0,.42)
    targets[side+'Hand'].location=(s*2.0,-.3,3.6+.09*math.sin(a))
  for side,s in [('L',1),('R',-1)]:arm.pose.bones[side+'Hand'].rotation_euler.y=s*.5
  for pb in arm.pose.bones:
   pb.keyframe_insert('location',frame=frame);pb.keyframe_insert('rotation_euler',frame=frame)
  for obj in targets.values():obj.keyframe_insert('location',frame=frame)
 # Sample evaluated pose into a constraint-free action; controls never ship to the browser.
 matrices=[]
 for frame in range(1,frames+1):
  scene.frame_set(frame);bpy.context.view_layer.update()
  matrices.append({pb.name:pb.matrix.copy() for pb in arm.pose.bones})
  if action_name=='Grab':
   contact=(arm.pose.bones['LForeArm'].tail+arm.pose.bones['RForeArm'].tail)*.5
   contacts.append([round((frame-1)/(frames-1),5),round(contact.x,5),round(contact.z-.4,5),round(-contact.y,5)])
 for pb in arm.pose.bones:
  for con in pb.constraints:con.mute=True
 arm.animation_data_clear();act=bpy.data.actions.new(action_name);arm.animation_data_create();arm.animation_data.action=act
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
arm.animation_data_clear();arm.animation_data_create()
for act in actions:
 tr=arm.animation_data.nla_tracks.new();tr.name=act.name;strip=tr.strips.new(act.name,1,act);tr.mute=True
arm.animation_data.action=actions[0];scene.frame_set(1)
for act in list(bpy.data.actions):
 if act not in actions:bpy.data.actions.remove(act)
out=ROOT/'public/assets/kong';out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);arm.select_set(True);bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'design/kong/kong-rig.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'kong.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_nla_strips_merged_animation_name='Idle',export_def_bones=True)
(ROOT/'src/kong-hand-samples.js').write_text('// Baked from the Rodin rig: car base follows both palms exactly.\nexport const KONG_HAND='+json.dumps(contacts,separators=(',',':'))+';\n',encoding='utf8')
print('KONG_EXPORT',json.dumps({'bytes':(out/'kong.glb').stat().st_size,'vertices':len(mesh.data.vertices),'actions':[a.name for a in actions],'handStart':contacts[0],'handEnd':contacts[-1]}))
